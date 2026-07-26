import { describe, expect, it, vi } from 'vitest'

import {
  getSenseVoiceLocalHealthUrl,
  normalizeSenseVoiceLocalBaseUrl,
  validateSenseVoiceLocalConfig,
} from './sensevoice-local'

describe('normalizeSenseVoiceLocalBaseUrl', () => {
  it('adds the OpenAI-compatible v1 path to a loopback endpoint', () => {
    expect(normalizeSenseVoiceLocalBaseUrl('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765/v1/')
  })

  it('preserves an explicit v1 path and rejects remote endpoints', () => {
    expect(normalizeSenseVoiceLocalBaseUrl('http://localhost:8765/v1')).toBe('http://localhost:8765/v1/')
    expect(normalizeSenseVoiceLocalBaseUrl('https://example.com/v1')).toBeUndefined()
  })
})

describe('getSenseVoiceLocalHealthUrl', () => {
  it('uses the service health route outside the OpenAI-compatible path', () => {
    expect(getSenseVoiceLocalHealthUrl('http://127.0.0.1:8765/v1/')).toBe('http://127.0.0.1:8765/health')
  })
})

describe('validateSenseVoiceLocalConfig', () => {
  it('accepts a ready local service without an API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch

    await expect(validateSenseVoiceLocalConfig({ baseUrl: 'http://127.0.0.1:8765/v1/' }, fetchImpl)).resolves.toMatchObject({
      valid: true,
    })
  })

  it('reports an actionable error when the local service is not reachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch

    await expect(validateSenseVoiceLocalConfig({ baseUrl: 'http://127.0.0.1:8765/v1/' }, fetchImpl)).resolves.toMatchObject({
      valid: false,
      reasonCode: 'unreachable',
    })
  })
})
