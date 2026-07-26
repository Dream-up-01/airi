import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'
import type { CommonRequestOptions } from '@xsai/shared'
import type { StreamTranscriptionDelta, StreamTranscriptionResult } from '@xsai/stream-transcription'

export const QWEN3_ASR_LOCAL_PROVIDER_ID = 'qwen3-asr-local'
export const QWEN3_ASR_LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:8001/'
export const QWEN3_ASR_LOCAL_DEFAULT_MODEL = 'Qwen/Qwen3-ASR-0.6B'
export const QWEN3_ASR_LOCAL_DEFAULT_LANGUAGE = 'zh'

const TARGET_SAMPLE_RATE = 16_000
const UPLOAD_CHUNK_SAMPLES = TARGET_SAMPLE_RATE / 2

type AudioChunk = ArrayBuffer | ArrayBufferView

export interface Qwen3AsrLocalExtraOptions {
  abortSignal?: AbortSignal
  inputAudioStream?: ReadableStream<AudioChunk>
  language?: string
}

export interface Qwen3AsrLocalStreamOptions extends CommonRequestOptions, Qwen3AsrLocalExtraOptions {
  file?: Blob
}

export interface Qwen3AsrLocalValidationResult {
  errors: Error[]
  reason: string
  reasonCode?: 'invalid_endpoint' | 'not_ready' | 'not_streaming' | 'unreachable'
  valid: boolean
}

interface QwenSessionResponse {
  session_id?: string
  language?: string
  text?: string
  error?: string
}

function isLoopbackHost(hostname: string) {
  return hostname === '127.0.0.1'
    || hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
}

export function normalizeQwen3AsrLocalBaseUrl(value: unknown) {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input)
    return QWEN3_ASR_LOCAL_DEFAULT_BASE_URL

  try {
    const url = new URL(input)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopbackHost(url.hostname))
      return undefined

    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
    url.search = ''
    url.hash = ''
    return url.toString()
  }
  catch {
    return undefined
  }
}

export function getQwen3AsrLocalHealthUrl(baseUrl: string) {
  return new URL('health', baseUrl).toString()
}

export async function validateQwen3AsrLocalConfig(
  config: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<Qwen3AsrLocalValidationResult> {
  const baseUrl = normalizeQwen3AsrLocalBaseUrl(config.baseUrl)
  if (!baseUrl) {
    return {
      errors: [new Error('Qwen3-ASR must use a localhost or 127.0.0.1 endpoint.')],
      reason: '',
      reasonCode: 'invalid_endpoint',
      valid: false,
    }
  }

  try {
    const response = await fetchImpl(getQwen3AsrLocalHealthUrl(baseUrl), {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    const payload = await response.json().catch(() => undefined) as { ok?: unknown, streaming?: unknown } | undefined
    if (!response.ok || payload?.ok !== true) {
      return {
        errors: [new Error('Qwen3-ASR local service is not ready.')],
        reason: '',
        reasonCode: 'not_ready',
        valid: false,
      }
    }
    if (payload.streaming !== true) {
      return {
        errors: [new Error('The endpoint is Qwen3-ASR but does not accept streaming microphone chunks.')],
        reason: '',
        reasonCode: 'not_streaming',
        valid: false,
      }
    }

    return { errors: [], reason: '', valid: true }
  }
  catch {
    return {
      errors: [new Error('Qwen3-ASR local service is unavailable.')],
      reason: '',
      reasonCode: 'unreachable',
      valid: false,
    }
  }
}

export function createQwen3AsrLocalProvider(
  baseURL: string,
  defaultLanguage = QWEN3_ASR_LOCAL_DEFAULT_LANGUAGE,
): TranscriptionProviderWithExtraOptions<string, Qwen3AsrLocalExtraOptions> {
  return {
    transcription: (model, extraOptions) => ({
      baseURL,
      model,
      language: extraOptions?.language ?? defaultLanguage,
      ...extraOptions,
    }),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function appendFloat32(previous: Float32Array, next: Float32Array) {
  if (previous.length === 0)
    return next.slice()

  const output = new Float32Array(previous.length + next.length)
  output.set(previous)
  output.set(next, previous.length)
  return output
}

function pcm16ChunkToFloat32(chunk: AudioChunk) {
  const bytes = chunk instanceof ArrayBuffer
    ? chunk
    : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
  const pcm16 = new Int16Array(bytes)
  const output = new Float32Array(pcm16.length)
  for (let index = 0; index < pcm16.length; index += 1)
    output[index] = (pcm16[index] ?? 0) / 32768
  return output
}

async function decodeFileToFloat32(file: Blob) {
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    const output = new Float32Array(decoded.length)
    const channelCount = Math.max(1, decoded.numberOfChannels)
    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = decoded.getChannelData(channel)
      for (let index = 0; index < output.length; index += 1)
        output[index] += (source[index] ?? 0) / channelCount
    }
    return output
  }
  finally {
    await context.close()
  }
}

async function* qwenAudioChunks(options: Qwen3AsrLocalStreamOptions): AsyncGenerator<Float32Array> {
  if (options.inputAudioStream) {
    const reader = options.inputAudioStream.getReader()
    try {
      while (true) {
        throwIfAborted(options.abortSignal)
        const { done, value } = await reader.read()
        if (done)
          break
        if (value)
          yield pcm16ChunkToFloat32(value)
      }
    }
    finally {
      reader.releaseLock()
    }
    return
  }

  if (options.file) {
    const audio = await decodeFileToFloat32(options.file)
    for (let offset = 0; offset < audio.length; offset += UPLOAD_CHUNK_SAMPLES) {
      throwIfAborted(options.abortSignal)
      yield audio.slice(offset, offset + UPLOAD_CHUNK_SAMPLES)
    }
    return
  }

  throw new TypeError('Qwen3-ASR streaming transcription requires microphone audio or an audio file.')
}

async function responseJson(response: Response, action: string): Promise<QwenSessionResponse> {
  const payload = await response.json().catch(() => ({})) as QwenSessionResponse
  if (!response.ok)
    throw new Error(`Qwen3-ASR ${action} failed (${response.status}): ${payload.error ?? response.statusText}`)
  return payload
}

function apiUrl(baseURL: CommonRequestOptions['baseURL'], path: string, sessionId?: string) {
  const url = new URL(path, baseURL instanceof URL ? baseURL : String(baseURL))
  if (sessionId)
    url.searchParams.set('session_id', sessionId)
  return url
}

export function streamQwen3AsrTranscription(options: Qwen3AsrLocalStreamOptions): StreamTranscriptionResult {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const deferredText = createDeferred<string>()
  let textStreamController: ReadableStreamDefaultController<string> | undefined
  let fullStreamController: ReadableStreamDefaultController<StreamTranscriptionDelta> | undefined
  let streamsClosed = false

  const textStream = new ReadableStream<string>({
    start(controller) {
      textStreamController = controller
    },
  })
  const fullStream = new ReadableStream<StreamTranscriptionDelta>({
    start(controller) {
      fullStreamController = controller
    },
  })

  function emitSnapshot(text: string, previous: string) {
    if (!text || text === previous)
      return
    textStreamController?.enqueue(text)
    fullStreamController?.enqueue({ delta: text, type: 'transcript.text.delta' })
  }

  function closeStreams() {
    if (streamsClosed)
      return
    streamsClosed = true
    fullStreamController?.enqueue({ delta: '', type: 'transcript.text.done' })
    fullStreamController?.close()
    textStreamController?.close()
  }

  function errorStreams(error: unknown) {
    if (streamsClosed)
      return
    streamsClosed = true
    fullStreamController?.error(error)
    textStreamController?.error(error)
  }

  void (async () => {
    let sessionId = ''
    let latestText = ''
    try {
      throwIfAborted(options.abortSignal)
      const language = options.language?.trim()
      const startResponse = await fetchImpl(apiUrl(options.baseURL, 'api/start'), {
        body: JSON.stringify({ language: language === 'auto' ? '' : language }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: options.abortSignal,
      })
      const started = await responseJson(startResponse, 'start')
      sessionId = started.session_id ?? ''
      if (!sessionId)
        throw new Error('Qwen3-ASR start response did not include a session id.')

      let pending = new Float32Array()
      for await (const chunk of qwenAudioChunks(options)) {
        pending = appendFloat32(pending, chunk)
        while (pending.length >= UPLOAD_CHUNK_SAMPLES) {
          throwIfAborted(options.abortSignal)
          const upload = pending.slice(0, UPLOAD_CHUNK_SAMPLES)
          pending = pending.slice(UPLOAD_CHUNK_SAMPLES)
          const response = await fetchImpl(apiUrl(options.baseURL, 'api/chunk', sessionId), {
            body: upload,
            headers: { 'Content-Type': 'application/octet-stream' },
            method: 'POST',
            signal: options.abortSignal,
          })
          const partial = await responseJson(response, 'chunk')
          const nextText = partial.text?.trim() ?? ''
          emitSnapshot(nextText, latestText)
          latestText = nextText || latestText
        }
      }

      if (pending.length > 0) {
        const response = await fetchImpl(apiUrl(options.baseURL, 'api/chunk', sessionId), {
          body: pending,
          headers: { 'Content-Type': 'application/octet-stream' },
          method: 'POST',
          signal: options.abortSignal,
        })
        const partial = await responseJson(response, 'tail chunk')
        const nextText = partial.text?.trim() ?? ''
        emitSnapshot(nextText, latestText)
        latestText = nextText || latestText
      }

      const finishResponse = await fetchImpl(apiUrl(options.baseURL, 'api/finish', sessionId), {
        method: 'POST',
        signal: options.abortSignal,
      })
      const finished = await responseJson(finishResponse, 'finish')
      const finalText = finished.text?.trim() || latestText
      emitSnapshot(finalText, latestText)
      closeStreams()
      deferredText.resolve(finalText)
    }
    catch (error) {
      if (sessionId) {
        void fetchImpl(apiUrl(options.baseURL, 'api/cancel', sessionId), {
          method: 'POST',
          signal: AbortSignal.timeout(1000),
        }).catch(() => undefined)
      }
      errorStreams(error)
      deferredText.reject(error)
    }
  })()

  return {
    fullStream,
    text: deferredText.promise,
    textStream,
  }
}
