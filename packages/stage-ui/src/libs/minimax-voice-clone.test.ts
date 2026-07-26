import { describe, expect, it, vi } from 'vitest'

import { cloneMiniMaxVoice, isSupportedMiniMaxCloneAudio, isValidMiniMaxVoiceId, MiniMaxVoiceCloneError } from './minimax-voice-clone'

function audioFile(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'audio/wav' })
}

function cloneRequest() {
  return {
    apiKey: 'minimax-key',
    sourceAudio: audioFile('source.wav'),
    sourceDurationSeconds: 12,
    promptAudio: audioFile('prompt.wav'),
    promptDurationSeconds: 4,
    promptText: '你好，AIRI。',
    voiceId: 'AiriFireflyV1',
  }
}

describe('miniMax voice clone', () => {
  it('accepts only MiniMax-compatible safe voice ids and audio file shapes', () => {
    expect(isValidMiniMaxVoiceId('AiriFireflyV1')).toBe(true)
    expect(isValidMiniMaxVoiceId('airi-voice_01')).toBe(true)
    expect(isValidMiniMaxVoiceId('1airiVoice')).toBe(false)
    expect(isValidMiniMaxVoiceId('airi-')).toBe(false)
    expect(isSupportedMiniMaxCloneAudio(audioFile('voice.wav'))).toBe(true)
    expect(isSupportedMiniMaxCloneAudio(audioFile('voice.ogg'))).toBe(false)
  })

  it('uploads source and prompt audio before creating the clone without exposing source paths', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { file_id: 101 }, base_resp: { status_code: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { file_id: 202 }, base_resp: { status_code: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ demo_audio: 'https://example.test/preview.mp3', base_resp: { status_code: 0 } })))

    const result = await cloneMiniMaxVoice({
      ...cloneRequest(),
      previewText: '你好，我是 AIRI。',
    }, fetcher)

    expect(result).toEqual({ voiceId: 'AiriFireflyV1', previewAudioUrl: 'https://example.test/preview.mp3' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    const sourceUpload = fetcher.mock.calls[0]!
    const promptUpload = fetcher.mock.calls[1]!
    const cloneInvocation = fetcher.mock.calls[2]!
    expect(String(sourceUpload[0])).toBe('https://api.minimax.io/v1/files/upload')
    expect((sourceUpload[1]!.body as FormData).get('purpose')).toBe('voice_clone')
    expect((promptUpload[1]!.body as FormData).get('purpose')).toBe('prompt_audio')
    expect(JSON.parse(String(cloneInvocation[1]!.body))).toMatchObject({
      file_id: 101,
      clone_prompt: { prompt_audio: 202, prompt_text: '你好，AIRI。' },
      language_boost: 'Chinese',
      model: 'speech-2.8-turbo',
      text: '你好，我是 AIRI。',
    })
  })

  it('uses the official mainland-China endpoint when the speech provider is configured for China', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { file_id: 101 }, base_resp: { status_code: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { file_id: 202 }, base_resp: { status_code: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ base_resp: { status_code: 0 } })))

    await cloneMiniMaxVoice({
      ...cloneRequest(),
      baseUrl: 'https://api.minimaxi.com',
    }, fetcher)

    expect(String(fetcher.mock.calls[0]![0])).toBe('https://api.minimaxi.com/v1/files/upload')
    expect(String(fetcher.mock.calls[2]![0])).toBe('https://api.minimaxi.com/v1/voice_clone')
  })

  it('rejects non-official clone endpoints before making a cloud request', async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(cloneMiniMaxVoice({
      ...cloneRequest(),
      baseUrl: 'https://example.invalid',
    }, fetcher)).rejects.toEqual(new MiniMaxVoiceCloneError('invalid-endpoint'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects invalid source audio before making a cloud request', async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(cloneMiniMaxVoice({
      ...cloneRequest(),
      sourceDurationSeconds: 8,
    }, fetcher)).rejects.toEqual(new MiniMaxVoiceCloneError('invalid-source-audio'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects unbounded preview text and non-finite audio durations before making a cloud request', async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(cloneMiniMaxVoice({
      ...cloneRequest(),
      previewText: 'a'.repeat(1001),
    }, fetcher)).rejects.toEqual(new MiniMaxVoiceCloneError('invalid-preview-text'))
    await expect(cloneMiniMaxVoice({
      ...cloneRequest(),
      promptDurationSeconds: Number.NaN,
    }, fetcher)).rejects.toEqual(new MiniMaxVoiceCloneError('invalid-prompt-audio'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns bounded error codes instead of provider response content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code: 1043, status_msg: 'secret should not leak' } })))

    await expect(cloneMiniMaxVoice(cloneRequest(), fetcher)).rejects.toEqual(new MiniMaxVoiceCloneError('upload-failed'))
  })

  it('identifies an invalid API key without surfacing the provider response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      base_resp: { status_code: 2049, status_msg: 'api key contents must not leak' },
    })))

    await expect(cloneMiniMaxVoice(cloneRequest(), fetcher)).rejects.toEqual(new MiniMaxVoiceCloneError('api-key-invalid'))
  })
})
