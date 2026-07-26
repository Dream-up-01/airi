import { describe, expect, it, vi } from 'vitest'

import {
  getQwen3AsrLocalHealthUrl,
  normalizeQwen3AsrLocalBaseUrl,
  streamQwen3AsrTranscription,
  validateQwen3AsrLocalConfig,
} from './qwen3-asr-local'

describe('qwen3-ASR local configuration', () => {
  it('normalizes loopback endpoints and rejects remote hosts', () => {
    expect(normalizeQwen3AsrLocalBaseUrl('http://127.0.0.1:8001')).toBe('http://127.0.0.1:8001/')
    expect(normalizeQwen3AsrLocalBaseUrl('http://localhost:8001/')).toBe('http://localhost:8001/')
    expect(normalizeQwen3AsrLocalBaseUrl('https://example.com')).toBeUndefined()
    expect(getQwen3AsrLocalHealthUrl('http://127.0.0.1:8001/')).toBe('http://127.0.0.1:8001/health')
  })

  it('requires a ready endpoint that explicitly supports streaming input', async () => {
    const readyFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, streaming: true }))) as typeof fetch
    await expect(validateQwen3AsrLocalConfig({ baseUrl: 'http://127.0.0.1:8001/' }, readyFetch)).resolves.toMatchObject({ valid: true })

    const batchOnlyFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))) as typeof fetch
    await expect(validateQwen3AsrLocalConfig({ baseUrl: 'http://127.0.0.1:8001/' }, batchOnlyFetch)).resolves.toMatchObject({
      reasonCode: 'not_streaming',
      valid: false,
    })
  })
})

describe('streamQwen3AsrTranscription', () => {
  it('batches PCM16 microphone chunks and resolves the authoritative final text', async () => {
    const inputAudioStream = new ReadableStream<ArrayBuffer>({
      start(controller) {
        for (let index = 0; index < 4; index += 1)
          controller.enqueue(new Int16Array(4000).fill(8192).buffer)
        controller.close()
      },
    })
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request)
      if (url.endsWith('/api/start'))
        return new Response(JSON.stringify({ session_id: 'session-1' }))
      if (url.includes('/api/chunk')) {
        const body = init?.body
        expect(body).toBeInstanceOf(Float32Array)
        if (!(body instanceof Float32Array))
          throw new TypeError('expected a Float32Array audio chunk')
        expect(body.length).toBe(8000)
        const chunkCalls = fetchMock.mock.calls.filter(([target]) => String(target).includes('/api/chunk')).length
        return new Response(JSON.stringify({ text: chunkCalls === 1 ? '你好' : '你好，世界' }))
      }
      if (url.includes('/api/finish'))
        return new Response(JSON.stringify({ text: '你好，世界。' }))
      throw new Error(`Unexpected request: ${url}`)
    })
    const fetchImpl = fetchMock as unknown as typeof fetch

    const result = streamQwen3AsrTranscription({
      baseURL: 'http://127.0.0.1:8001/',
      fetch: fetchImpl,
      inputAudioStream,
      model: 'Qwen/Qwen3-ASR-0.6B',
    })

    const snapshots: string[] = []
    for await (const snapshot of result.textStream)
      snapshots.push(snapshot)

    await expect(result.text).resolves.toBe('你好，世界。')
    expect(snapshots).toEqual(['你好', '你好，世界', '你好，世界。'])
    expect(fetchMock.mock.calls.filter(([target]) => String(target).includes('/api/chunk'))).toHaveLength(2)
  })
})
