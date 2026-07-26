export const GPT_SOVITS_LOCAL_PROVIDER_ID = 'gpt-sovits-local'
export const GPT_SOVITS_LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:9888/v1/'
export const GPT_SOVITS_LOCAL_DEFAULT_MODEL = 'airi-firefly-v4'
export const GPT_SOVITS_LOCAL_DEFAULT_VOICE = 'airi-firefly'

export interface GptSovitsLocalValidationResult {
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
 * Keeps the local GPT-SoVITS bridge on a loopback OpenAI-compatible endpoint.
 * The bridge owns reference paths and model weights; the renderer must never
 * be able to replace those with arbitrary filesystem paths.
 */
export function normalizeGptSovitsLocalBaseUrl(value: unknown) {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input)
    return GPT_SOVITS_LOCAL_DEFAULT_BASE_URL

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

export function getGptSovitsLocalHealthUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/v1\/?$/, '')
  url.pathname = `${path || ''}/health`
  return url.toString()
}

export async function validateGptSovitsLocalConfig(
  config: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<GptSovitsLocalValidationResult> {
  const baseUrl = normalizeGptSovitsLocalBaseUrl(config.baseUrl)
  if (!baseUrl) {
    return {
      errors: [new Error('GPT-SoVITS must use a localhost or 127.0.0.1 endpoint.')],
      reason: '',
      reasonCode: 'invalid_endpoint',
      valid: false,
    }
  }

  try {
    const response = await fetchImpl(getGptSovitsLocalHealthUrl(baseUrl), {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    const payload = await response.json().catch(() => undefined) as { ok?: unknown } | undefined
    if (!response.ok || payload?.ok !== true) {
      return {
        errors: [new Error('GPT-SoVITS local bridge is unavailable or still loading.')],
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
      errors: [new Error('GPT-SoVITS local bridge is unavailable or still loading.')],
      reason: '',
      reasonCode: 'unreachable',
      valid: false,
    }
  }
}
