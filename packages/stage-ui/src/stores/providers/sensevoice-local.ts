export const SENSEVOICE_LOCAL_PROVIDER_ID = 'sensevoice-local'
export const SENSEVOICE_LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:8765/v1/'
export const SENSEVOICE_LOCAL_DEFAULT_MODEL = 'sensevoice-small'
export const SENSEVOICE_LOCAL_DEFAULT_LANGUAGE = 'zh'

export interface SenseVoiceLocalValidationResult {
  errors: Error[]
  reason: string
  reasonCode?: 'invalid_endpoint' | 'not_ready' | 'unreachable'
  valid: boolean
}

function isLoopbackHost(hostname: string) {
  return hostname === '127.0.0.1'
    || hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
}

/**
 * Turns a local SenseVoice endpoint into the OpenAI-compatible base URL used
 * by the existing AIRI transcription transport.
 */
export function normalizeSenseVoiceLocalBaseUrl(value: unknown) {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input)
    return SENSEVOICE_LOCAL_DEFAULT_BASE_URL

  try {
    const url = new URL(input)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopbackHost(url.hostname))
      return undefined

    url.search = ''
    url.hash = ''
    const path = url.pathname.replace(/\/+$/, '')
    url.pathname = path.endsWith('/v1') ? `${path}/` : `${path}/v1/`
    return url.toString()
  }
  catch {
    return undefined
  }
}

export function getSenseVoiceLocalHealthUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/v1\/?$/, '')
  url.pathname = `${path || ''}/health`
  return url.toString()
}

export async function validateSenseVoiceLocalConfig(
  config: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<SenseVoiceLocalValidationResult> {
  const baseUrl = normalizeSenseVoiceLocalBaseUrl(config.baseUrl)
  if (!baseUrl) {
    return {
      errors: [new Error('SenseVoice must use a localhost or 127.0.0.1 endpoint.')],
      reason: '',
      reasonCode: 'invalid_endpoint',
      valid: false,
    }
  }

  try {
    const response = await fetchImpl(getSenseVoiceLocalHealthUrl(baseUrl), {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    const payload = await response.json().catch(() => undefined) as { ok?: unknown } | undefined

    if (!response.ok || payload?.ok !== true) {
      return {
        errors: [new Error('SenseVoice local service is unavailable.')],
        reason: '',
        reasonCode: 'not_ready',
        valid: false,
      }
    }

    return {
      errors: [],
      reason: '',
      valid: true,
    }
  }
  catch {
    return {
      errors: [new Error('SenseVoice local service is unavailable.')],
      reason: '',
      reasonCode: 'unreachable',
      valid: false,
    }
  }
}
