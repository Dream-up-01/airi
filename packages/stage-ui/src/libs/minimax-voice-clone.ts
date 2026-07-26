const MINIMAX_GLOBAL_VOICE_CLONE_BASE_URL = 'https://api.minimax.io'
const MINIMAX_CHINA_VOICE_CLONE_BASE_URL = 'https://api.minimaxi.com'
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const SOURCE_MIN_DURATION_SECONDS = 10
const SOURCE_MAX_DURATION_SECONDS = 5 * 60
const PROMPT_MAX_DURATION_SECONDS = 8

export type MiniMaxVoiceCloneErrorCode
  = | 'api-key-required'
    | 'api-key-invalid'
    | 'account-balance-insufficient'
    | 'invalid-source-audio'
    | 'invalid-prompt-audio'
    | 'invalid-prompt-text'
    | 'invalid-preview-text'
    | 'invalid-endpoint'
    | 'invalid-voice-id'
    | 'upload-failed'
    | 'clone-failed'
    | 'usage-limit-exceeded'
    | 'voice-cloning-unavailable'
    | 'voice-id-duplicate'
    | 'network-failed'

export class MiniMaxVoiceCloneError extends Error {
  constructor(readonly code: MiniMaxVoiceCloneErrorCode) {
    super(code)
    this.name = 'MiniMaxVoiceCloneError'
  }
}

export interface MiniMaxCloneAudioFile extends Blob {
  name: string
}

export interface MiniMaxVoiceCloneRequest {
  apiKey: string
  /**
   * The speech provider endpoint selects an official MiniMax service region.
   * It is never used as an arbitrary upload target.
   */
  baseUrl?: string
  sourceAudio: MiniMaxCloneAudioFile
  sourceDurationSeconds: number
  promptAudio: MiniMaxCloneAudioFile
  promptDurationSeconds: number
  promptText: string
  voiceId: string
  previewText?: string
  previewModel?: 'speech-2.8-turbo' | 'speech-2.8-hd'
  signal?: AbortSignal
}

export interface MiniMaxVoiceCloneResult {
  voiceId: string
  previewAudioUrl?: string
}

interface MiniMaxUploadResponse {
  file?: {
    file_id?: number | string
  }
  base_resp?: {
    status_code?: number
  }
}

interface MiniMaxCloneResponse {
  demo_audio?: string
  base_resp?: {
    status_code?: number
  }
}

export function isValidMiniMaxVoiceId(value: string): boolean {
  return /^[a-z][\w-]{6,254}[a-z\d]$/i.test(value)
}

export function isSupportedMiniMaxCloneAudio(file: Pick<MiniMaxCloneAudioFile, 'name' | 'size'>): boolean {
  return /\.(?:m4a|mp3|wav)$/i.test(file.name) && file.size > 0 && file.size <= MAX_AUDIO_BYTES
}

function hasSuccessfulBaseResponse(response: { base_resp?: { status_code?: number } }): boolean {
  return response.base_resp?.status_code === undefined || response.base_resp.status_code === 0
}

function trimText(value: string): string {
  return value.trim()
}

function resolveVoiceCloneBaseUrl(configuredBaseUrl?: string): string {
  if (!configuredBaseUrl?.trim())
    return MINIMAX_GLOBAL_VOICE_CLONE_BASE_URL

  let hostname: string
  try {
    hostname = new URL(configuredBaseUrl.trim()).hostname.toLowerCase()
  }
  catch {
    throw new MiniMaxVoiceCloneError('invalid-endpoint')
  }

  if (hostname === 'api.minimaxi.com')
    return MINIMAX_CHINA_VOICE_CLONE_BASE_URL

  if (hostname === 'api.minimax.io' || hostname === 'api-uw.minimax.io')
    return MINIMAX_GLOBAL_VOICE_CLONE_BASE_URL

  throw new MiniMaxVoiceCloneError('invalid-endpoint')
}

/**
 * Keeps MiniMax response details out of the UI while preserving the small
 * set of configuration errors a user can actually resolve.
 */
function errorCodeFromMiniMaxResponse(
  statusCode: number | undefined,
  fallback: MiniMaxVoiceCloneErrorCode,
): MiniMaxVoiceCloneErrorCode {
  switch (statusCode) {
    case 1008:
      return 'account-balance-insufficient'
    case 2038:
      return 'voice-cloning-unavailable'
    case 2039:
      return 'voice-id-duplicate'
    case 2049:
      return 'api-key-invalid'
    case 2056:
      return 'usage-limit-exceeded'
    default:
      return fallback
  }
}

function assertRequestIsValid(request: MiniMaxVoiceCloneRequest) {
  if (!request.apiKey.trim())
    throw new MiniMaxVoiceCloneError('api-key-required')

  if (!isSupportedMiniMaxCloneAudio(request.sourceAudio)
    || !Number.isFinite(request.sourceDurationSeconds)
    || request.sourceDurationSeconds < SOURCE_MIN_DURATION_SECONDS
    || request.sourceDurationSeconds > SOURCE_MAX_DURATION_SECONDS) {
    throw new MiniMaxVoiceCloneError('invalid-source-audio')
  }

  if (!isSupportedMiniMaxCloneAudio(request.promptAudio)
    || !Number.isFinite(request.promptDurationSeconds)
    || request.promptDurationSeconds <= 0
    || request.promptDurationSeconds >= PROMPT_MAX_DURATION_SECONDS) {
    throw new MiniMaxVoiceCloneError('invalid-prompt-audio')
  }

  if (!trimText(request.promptText) || trimText(request.promptText).length > 200)
    throw new MiniMaxVoiceCloneError('invalid-prompt-text')

  if (!isValidMiniMaxVoiceId(request.voiceId))
    throw new MiniMaxVoiceCloneError('invalid-voice-id')

  if (trimText(request.previewText ?? '').length > 1000)
    throw new MiniMaxVoiceCloneError('invalid-preview-text')
}

async function responseJson<T>(response: Response, fallback: MiniMaxVoiceCloneErrorCode): Promise<T> {
  let body: T
  try {
    body = await response.json() as T
  }
  catch {
    throw new MiniMaxVoiceCloneError(fallback)
  }

  if (!response.ok) {
    const responseStatusCode = (body as { base_resp?: { status_code?: number } }).base_resp?.status_code
    throw new MiniMaxVoiceCloneError(errorCodeFromMiniMaxResponse(responseStatusCode, fallback))
  }

  return body
}

async function uploadAudio(
  baseUrl: string,
  apiKey: string,
  purpose: 'voice_clone' | 'prompt_audio',
  file: MiniMaxCloneAudioFile,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<number | string> {
  const form = new FormData()
  form.set('purpose', purpose)
  form.set('file', file, file.name)

  let response: Response
  try {
    response = await fetcher(`${baseUrl}/v1/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      body: form,
      signal,
    })
  }
  catch {
    throw new MiniMaxVoiceCloneError('network-failed')
  }

  const body = await responseJson<MiniMaxUploadResponse>(response, 'upload-failed')
  if (!hasSuccessfulBaseResponse(body) || body.file?.file_id === undefined)
    throw new MiniMaxVoiceCloneError(errorCodeFromMiniMaxResponse(body.base_resp?.status_code, 'upload-failed'))

  return body.file.file_id
}

export async function cloneMiniMaxVoice(
  request: MiniMaxVoiceCloneRequest,
  fetcher: typeof fetch = fetch,
): Promise<MiniMaxVoiceCloneResult> {
  assertRequestIsValid(request)
  const baseUrl = resolveVoiceCloneBaseUrl(request.baseUrl)

  const sourceFileId = await uploadAudio(baseUrl, request.apiKey, 'voice_clone', request.sourceAudio, request.signal, fetcher)
  const promptFileId = await uploadAudio(baseUrl, request.apiKey, 'prompt_audio', request.promptAudio, request.signal, fetcher)
  const previewText = trimText(request.previewText ?? '')
  const body: Record<string, unknown> = {
    file_id: sourceFileId,
    voice_id: request.voiceId.trim(),
    clone_prompt: {
      prompt_audio: promptFileId,
      prompt_text: trimText(request.promptText),
    },
    language_boost: 'Chinese',
    need_noise_reduction: false,
    need_volume_normalization: false,
    aigc_watermark: false,
  }

  if (previewText) {
    body.text = previewText
    body.model = request.previewModel ?? 'speech-2.8-turbo'
  }

  let response: Response
  try {
    response = await fetcher(`${baseUrl}/v1/voice_clone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${request.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })
  }
  catch {
    throw new MiniMaxVoiceCloneError('network-failed')
  }

  const result = await responseJson<MiniMaxCloneResponse>(response, 'clone-failed')
  if (!hasSuccessfulBaseResponse(result))
    throw new MiniMaxVoiceCloneError(errorCodeFromMiniMaxResponse(result.base_resp?.status_code, 'clone-failed'))

  return {
    voiceId: request.voiceId.trim(),
    previewAudioUrl: typeof result.demo_audio === 'string' && result.demo_audio ? result.demo_audio : undefined,
  }
}

export const minimaxVoiceCloneLimits = {
  maxAudioBytes: MAX_AUDIO_BYTES,
  promptMaxDurationSeconds: PROMPT_MAX_DURATION_SECONDS,
  sourceMaxDurationSeconds: SOURCE_MAX_DURATION_SECONDS,
  sourceMinDurationSeconds: SOURCE_MIN_DURATION_SECONDS,
} as const
