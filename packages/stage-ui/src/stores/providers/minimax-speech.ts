import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

const MINIMAX_GLOBAL_BASE_URL = 'https://api.minimax.io'
const MINIMAX_GLOBAL_LOW_LATENCY_BASE_URL = 'https://api-uw.minimax.io'
const MINIMAX_CHINA_BASE_URL = 'https://api.minimaxi.com'
export const MINIMAX_SPEECH_DEFAULT_MODEL = 'speech-2.8-turbo' as const
export const MINIMAX_SPEECH_DEFAULT_VOICE = 'AiriFireflyCN20260710_2011R7' as const
const SUPPORTED_MINIMAX_SPEECH_MODELS = new Set<MiniMaxSpeechModel>([
  'speech-2.8-turbo',
  'speech-2.8-hd',
])
const SUPPORTED_MINIMAX_ORIGINS = new Set([
  MINIMAX_GLOBAL_BASE_URL,
  MINIMAX_GLOBAL_LOW_LATENCY_BASE_URL,
  MINIMAX_CHINA_BASE_URL,
])

export type MiniMaxSpeechModel = 'speech-2.8-turbo' | 'speech-2.8-hd'
export type MiniMaxVoiceKind = 'system' | 'voice-cloning' | 'voice-generation'
export type MiniMaxVoiceCatalogErrorCode
  = | 'api-key-required'
    | 'invalid-endpoint'
    | 'network-failed'
    | 'request-failed'
    | 'provider-rejected'
    | 'malformed-response'

export interface MiniMaxAvailableVoice {
  id: string
  name: string
  kind: MiniMaxVoiceKind
}

export interface ListMiniMaxAvailableVoicesOptions {
  signal?: AbortSignal
  fetcher?: typeof fetch
}

export class MiniMaxVoiceCatalogError extends Error {
  constructor(readonly code: MiniMaxVoiceCatalogErrorCode) {
    super(code)
    this.name = 'MiniMaxVoiceCatalogError'
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number, integer = false) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const bounded = Math.min(max, Math.max(min, numeric))
  return integer ? Math.round(bounded) : bounded
}

function statusCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function normalizeMiniMaxSpeechModel(value: unknown): MiniMaxSpeechModel | undefined {
  const model = stringValue(value) as MiniMaxSpeechModel
  return SUPPORTED_MINIMAX_SPEECH_MODELS.has(model) ? model : undefined
}

function miniMaxEmotion(value: unknown): 'calm' | 'happy' | undefined {
  switch (value) {
    case 'cheerful':
    case 'playful':
      return 'happy'
    case 'comforting':
    case 'neutral':
    case 'serious':
    case 'warm':
      return 'calm'
    default:
      return undefined
  }
}

export function normalizeMiniMaxSpeechBaseUrl(value: unknown): string | undefined {
  const configured = stringValue(value) || MINIMAX_GLOBAL_BASE_URL

  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
      || !SUPPORTED_MINIMAX_ORIGINS.has(url.origin)
      || !/^\/*$/.test(url.pathname)) {
      return undefined
    }

    return url.origin
  }
  catch {
    return undefined
  }
}

function miniMaxVoiceCatalogBaseUrl(baseUrl: string): string {
  return baseUrl === MINIMAX_GLOBAL_LOW_LATENCY_BASE_URL
    ? MINIMAX_GLOBAL_BASE_URL
    : baseUrl
}

function parseVoiceCatalogEntries(value: unknown, kind: MiniMaxVoiceKind): MiniMaxAvailableVoice[] {
  if (value === undefined)
    return []
  if (!Array.isArray(value))
    throw new MiniMaxVoiceCatalogError('malformed-response')

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object')
      throw new MiniMaxVoiceCatalogError('malformed-response')

    const record = entry as Record<string, unknown>
    const id = stringValue(record.voice_id)
    if (!id || id.length > 256)
      throw new MiniMaxVoiceCatalogError('malformed-response')

    const providerName = stringValue(record.voice_name)
    return {
      id,
      name: providerName && providerName.length <= 128 ? providerName : id,
      kind,
    }
  })
}

export async function listMiniMaxAvailableVoices(
  config: Record<string, unknown>,
  options: ListMiniMaxAvailableVoicesOptions = {},
): Promise<MiniMaxAvailableVoice[]> {
  const apiKey = stringValue(config.apiKey)
  if (!apiKey)
    throw new MiniMaxVoiceCatalogError('api-key-required')

  const baseUrl = normalizeMiniMaxSpeechBaseUrl(config.baseUrl)
  if (!baseUrl)
    throw new MiniMaxVoiceCatalogError('invalid-endpoint')

  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(`${miniMaxVoiceCatalogBaseUrl(baseUrl)}/v1/get_voice`, {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ voice_type: 'all' }),
    })
  }
  catch (error) {
    if (options.signal?.aborted)
      throw error
    throw new MiniMaxVoiceCatalogError('network-failed')
  }

  if (!response.ok)
    throw new MiniMaxVoiceCatalogError('request-failed')

  let payload: unknown
  try {
    payload = await response.json()
  }
  catch {
    throw new MiniMaxVoiceCatalogError('malformed-response')
  }

  if (!payload || typeof payload !== 'object')
    throw new MiniMaxVoiceCatalogError('malformed-response')

  const record = payload as Record<string, unknown>
  const baseResponse = record.base_resp
  if (baseResponse !== undefined && (!baseResponse || typeof baseResponse !== 'object'))
    throw new MiniMaxVoiceCatalogError('malformed-response')

  const providerStatusCode = statusCode((baseResponse as Record<string, unknown> | undefined)?.status_code)
  if (providerStatusCode !== undefined && providerStatusCode !== 0)
    throw new MiniMaxVoiceCatalogError('provider-rejected')

  const voices = [
    ...parseVoiceCatalogEntries(record.system_voice, 'system'),
    ...parseVoiceCatalogEntries(record.voice_cloning, 'voice-cloning'),
    ...parseVoiceCatalogEntries(record.voice_generation, 'voice-generation'),
  ]
  const uniqueVoices = new Map<string, MiniMaxAvailableVoice>()
  for (const voice of voices) {
    if (!uniqueVoices.has(voice.id))
      uniqueVoices.set(voice.id, voice)
  }
  return [...uniqueVoices.values()]
}

function decodeMiniMaxAudio(payload: unknown): Uint8Array {
  if (!payload || typeof payload !== 'object')
    throw new Error('MiniMax TTS returned malformed response data')

  const response = payload as {
    base_resp?: { status_code?: unknown }
    data?: { audio?: unknown, status?: unknown }
  }
  const providerStatusCode = statusCode(response.base_resp?.status_code)
  if (providerStatusCode !== undefined && providerStatusCode !== 0)
    throw new Error(`MiniMax TTS generation failed with code ${providerStatusCode}`)

  if (typeof response.data?.audio !== 'string' || !response.data.audio.trim())
    throw new Error('MiniMax TTS response did not contain audio')

  const audioHex = response.data.audio.trim().toLowerCase()
  if (audioHex.length % 2 !== 0 || !/^[\da-f]+$/.test(audioHex))
    throw new Error('MiniMax TTS returned invalid audio data')

  const audio = new Uint8Array(audioHex.length / 2)
  for (let index = 0; index < audioHex.length; index += 2)
    audio[index / 2] = Number.parseInt(audioHex.slice(index, index + 2), 16)
  return audio
}

export function createMiniMaxSpeechProvider(
  config: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): SpeechProviderWithExtraOptions<string, Record<string, unknown>> {
  const apiKey = stringValue(config.apiKey)
  if (!apiKey)
    throw new Error('MiniMax API key is required')

  const baseUrl = normalizeMiniMaxSpeechBaseUrl(config.baseUrl)
  if (!baseUrl)
    throw new Error('MiniMax API endpoint is invalid')

  const configuredModelValue = stringValue(config.model)
  const configuredModel = normalizeMiniMaxSpeechModel(configuredModelValue || MINIMAX_SPEECH_DEFAULT_MODEL)
  if (!configuredModel)
    throw new Error('MiniMax speech model is unsupported')

  return {
    speech: (model: string, requestConfig: Record<string, unknown> = {}) => {
      const requestedModelValue = stringValue(model)
      const selectedModel = normalizeMiniMaxSpeechModel(requestedModelValue || configuredModel)
      if (!selectedModel)
        throw new Error('MiniMax speech model is unsupported')

      return {
        baseURL: `${baseUrl}/v1/`,
        model: selectedModel,
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (!init?.body || typeof init.body !== 'string')
            throw new Error('MiniMax TTS request body is invalid')

          const request = JSON.parse(init.body) as Record<string, unknown>
          const text = stringValue(request.input)
          const voiceId = stringValue(request.voice) || MINIMAX_SPEECH_DEFAULT_VOICE
          const emotion = miniMaxEmotion(requestConfig?.voiceStyle)
          if (!text)
            throw new Error('MiniMax TTS input is required')

          const response = await fetcher(`${baseUrl}/v1/t2a_v2`, {
            method: 'POST',
            signal: init.signal,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: selectedModel,
              text,
              // The stage REST pipeline cannot play partial response frames: it
              // decodes and schedules audio only after this request resolves.
              // Asking MiniMax for one complete payload avoids concatenating
              // provider frames that may contain a cumulative final MP3.
              stream: false,
              language_boost: 'auto',
              voice_setting: {
                voice_id: voiceId,
                speed: boundedNumber(requestConfig?.speed, 0.5, 2, 1),
                vol: boundedNumber(requestConfig?.volume, 0.1, 10, 1),
                pitch: boundedNumber(requestConfig?.pitch, -12, 12, 0, true),
                ...(emotion ? { emotion } : {}),
              },
              audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: 'mp3',
                channel: 1,
              },
            }),
          })

          if (!response.ok)
            throw new Error(`MiniMax TTS request failed with status ${response.status}`)

          let payload: unknown
          try {
            payload = await response.json()
          }
          catch {
            throw new Error('MiniMax TTS returned malformed response data')
          }
          const audio = decodeMiniMaxAudio(payload)
          return new Response(audio.buffer as ArrayBuffer, {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          })
        },
      }
    },
  }
}
