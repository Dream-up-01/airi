import { describe, expect, it, vi } from 'vitest'

import {
  getGptSovitsLocalHealthUrl,
  GPT_SOVITS_LOCAL_DEFAULT_BASE_URL,
  normalizeGptSovitsLocalBaseUrl,
  validateGptSovitsLocalConfig,
} from './gpt-sovits-local'

describe('gpt-sovits local provider helpers', () => {
  it('normalizes loopback endpoints to the bridge v1 URL', () => {
    expect(normalizeGptSovitsLocalBaseUrl('http://localhost:9888')).toBe('http://localhost:9888/v1/')
    expect(normalizeGptSovitsLocalBaseUrl('http://127.0.0.1:9888/v1')).toBe(GPT_SOVITS_LOCAL_DEFAULT_BASE_URL)
    expect(getGptSovitsLocalHealthUrl(GPT_SOVITS_LOCAL_DEFAULT_BASE_URL)).toBe('http://127.0.0.1:9888/health')
  })

  it('rejects remote endpoints so reference bindings remain local', () => {
    expect(normalizeGptSovitsLocalBaseUrl('https://example.com/v1/')).toBeUndefined()
  })

  it('accepts a ready bridge without inspecting local paths', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(validateGptSovitsLocalConfig({}, fetchImpl)).resolves.toMatchObject({ valid: true })
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9888/health', expect.objectContaining({ method: 'GET' }))
  })

  it('reports unavailable bridges with a stable reason code', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'))
    await expect(validateGptSovitsLocalConfig({}, fetchImpl)).resolves.toMatchObject({
      reasonCode: 'unreachable',
      valid: false,
    })
  })
})
