import type { MiniMaxVoiceCatalogError } from './minimax-speech'

import { generateSpeech } from '@xsai/generate-speech'
import { describe, expect, it, vi } from 'vitest'

import { createMiniMaxSpeechProvider, listMiniMaxAvailableVoices, normalizeMiniMaxSpeechBaseUrl } from './minimax-speech'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('miniMax speech provider', () => {
  it('accepts only official HTTPS service origins', () => {
    expect(normalizeMiniMaxSpeechBaseUrl(undefined)).toBe('https://api.minimax.io')
    expect(normalizeMiniMaxSpeechBaseUrl('https://api-uw.minimax.io/')).toBe('https://api-uw.minimax.io')
    expect(normalizeMiniMaxSpeechBaseUrl('https://api.minimaxi.com')).toBe('https://api.minimaxi.com')
    expect(normalizeMiniMaxSpeechBaseUrl('http://api.minimax.io')).toBeUndefined()
    expect(normalizeMiniMaxSpeechBaseUrl('https://example.com')).toBeUndefined()
  })

  it('requests one complete audio payload instead of assembling streaming frames', async () => {
    const abortController = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: { audio: '01020304', status: 2 },
      base_resp: { status_code: 0 },
    }))
    const provider = createMiniMaxSpeechProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api-uw.minimax.io',
    }, fetcher)

    const result = await generateSpeech({
      ...provider.speech('speech-2.8-turbo'),
      abortSignal: abortController.signal,
      input: '你好',
      voice: 'Mandarin_Gentle_Woman',
    })

    expect([...new Uint8Array(result)]).toEqual([1, 2, 3, 4])
    expect(fetcher).toHaveBeenCalledWith('https://api-uw.minimax.io/v1/t2a_v2', expect.objectContaining({
      signal: abortController.signal,
    }))
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({
      model: 'speech-2.8-turbo',
      stream: false,
      text: '你好',
      voice_setting: { voice_id: 'Mandarin_Gentle_Woman' },
    })
  })

  it('forwards the selected HD model to MiniMax instead of forcing Turbo', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: { audio: 'aabb', status: 2 },
      base_resp: { status_code: 0 },
    }))
    const provider = createMiniMaxSpeechProvider({ apiKey: 'test-key' }, fetcher)

    await generateSpeech({
      ...provider.speech('speech-2.8-hd'),
      input: '你好',
      voice: 'Mandarin_Gentle_Woman',
    })

    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).model).toBe('speech-2.8-hd')
  })

  it('rejects unsupported models before network IO', () => {
    const fetcher = vi.fn<typeof fetch>()
    const provider = createMiniMaxSpeechProvider({ apiKey: 'test-key' }, fetcher)

    expect(() => provider.speech('speech-unknown')).toThrow('model is unsupported')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('accepts a successful string status code', async () => {
    const provider = createMiniMaxSpeechProvider({ apiKey: 'test-key' }, vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: { audio: 'aabb', status: 2 },
      base_resp: { status_code: '0' },
    })))

    const result = await generateSpeech({
      ...provider.speech('speech-2.8-turbo'),
      input: '你好',
      voice: 'Mandarin_Gentle_Woman',
    })

    expect([...new Uint8Array(result)]).toEqual([0xAA, 0xBB])
  })

  it('maps only bounded trusted voice style settings into the provider request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: { audio: 'aabb', status: 2 },
      base_resp: { status_code: 0 },
    }))
    const provider = createMiniMaxSpeechProvider({ apiKey: 'test-key' }, fetcher)

    await generateSpeech({
      ...provider.speech('speech-2.8-turbo', {
        speed: 9,
        volume: -1,
        pitch: 99,
        voiceStyle: 'playful',
      }),
      input: '你好',
      voice: 'Mandarin_Gentle_Woman',
    })

    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).voice_setting).toEqual({
      voice_id: 'Mandarin_Gentle_Woman',
      speed: 2,
      vol: 0.1,
      pitch: 12,
      emotion: 'happy',
    })
  })

  it('reports MiniMax string status codes as provider failures', async () => {
    const provider = createMiniMaxSpeechProvider({ apiKey: 'test-key' }, vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      base_resp: { status_code: '1008' },
    })))

    await expect(generateSpeech({
      ...provider.speech('speech-2.8-turbo'),
      input: '你好',
      voice: 'Mandarin_Gentle_Woman',
    })).rejects.toThrow('generation failed with code 1008')
  })

  it('rejects malformed or empty audio responses', async () => {
    const malformedProvider = createMiniMaxSpeechProvider({ apiKey: 'test-key' }, vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json')))
    const emptyProvider = createMiniMaxSpeechProvider({ apiKey: 'test-key' }, vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: { audio: '', status: 2 },
      base_resp: { status_code: 0 },
    })))

    await expect(generateSpeech({
      ...malformedProvider.speech('speech-2.8-turbo'),
      input: '你好',
      voice: 'Mandarin_Gentle_Woman',
    })).rejects.toThrow('malformed response data')
    await expect(generateSpeech({
      ...emptyProvider.speech('speech-2.8-turbo'),
      input: '你好',
      voice: 'Mandarin_Gentle_Woman',
    })).rejects.toThrow('did not contain audio')
  })

  it('rejects missing credentials and unsupported endpoints before network IO', () => {
    expect(() => createMiniMaxSpeechProvider({})).toThrow('API key is required')
    expect(() => createMiniMaxSpeechProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com',
    })).toThrow('endpoint is invalid')
  })

  it('loads and narrows the account voice catalog without retaining provider descriptions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      system_voice: [{ voice_id: 'Mandarin_Gentle_Woman', voice_name: 'Gentle Woman', description: ['ignored'] }],
      voice_cloning: [{ voice_id: 'AiriFireflyCN20260710_2011R7', description: ['ignored'] }],
      voice_generation: [{ voice_id: 'generated-voice', voice_name: 'Generated voice' }],
      base_resp: { status_code: 0, status_msg: 'success' },
    }))

    const voices = await listMiniMaxAvailableVoices({
      apiKey: 'test-key',
      baseUrl: 'https://api.minimaxi.com',
    }, { fetcher })

    expect(voices).toEqual([
      { id: 'Mandarin_Gentle_Woman', name: 'Gentle Woman', kind: 'system' },
      { id: 'AiriFireflyCN20260710_2011R7', name: 'AiriFireflyCN20260710_2011R7', kind: 'voice-cloning' },
      { id: 'generated-voice', name: 'Generated voice', kind: 'voice-generation' },
    ])
    expect(fetcher).toHaveBeenCalledWith('https://api.minimaxi.com/v1/get_voice', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ voice_type: 'all' }),
    }))
  })

  it('uses the global management endpoint for the low-latency speech origin', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      system_voice: [],
      voice_cloning: [],
      voice_generation: [],
      base_resp: { status_code: '0' },
    }))

    await listMiniMaxAvailableVoices({
      apiKey: 'test-key',
      baseUrl: 'https://api-uw.minimax.io',
    }, { fetcher })

    expect(fetcher).toHaveBeenCalledWith('https://api.minimax.io/v1/get_voice', expect.any(Object))
  })

  it('returns stable voice-catalog errors without exposing provider response details', async () => {
    const providerRejected = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      base_resp: { status_code: 2054, status_msg: 'provider detail must not escape' },
    }))
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      system_voice: 'not-an-array',
      base_resp: { status_code: 0 },
    }))

    await expect(listMiniMaxAvailableVoices({ apiKey: 'test-key' }, { fetcher: providerRejected }))
      .rejects
      .toEqual(expect.objectContaining<Partial<MiniMaxVoiceCatalogError>>({ code: 'provider-rejected' }))
    await expect(listMiniMaxAvailableVoices({ apiKey: 'test-key' }, { fetcher: malformed }))
      .rejects
      .toEqual(expect.objectContaining<Partial<MiniMaxVoiceCatalogError>>({ code: 'malformed-response' }))
  })
})
