import { afterEach, describe, expect, it, vi } from 'vitest'

const log = vi.fn()
const withFields = vi.fn(() => ({ log }))

vi.mock('../utils/logger', () => ({
  useLogger: () => ({ log: vi.fn(), withFields }),
}))

describe('minecraft environment config privacy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('never sends secrets, usernames or passwords to structured logging', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'secret-openai-key')
    vi.stubEnv('OPENAI_API_BASEURL', 'http://localhost:11434/v1')
    vi.stubEnv('OPENAI_MODEL', 'local-model')
    vi.stubEnv('OPENAI_REASONING_MODEL', 'local-reasoning-model')
    vi.stubEnv('BOT_USERNAME', 'private-player-name')
    vi.stubEnv('BOT_PASSWORD', 'private-game-password')
    vi.stubEnv('AIRI_WS_TOKEN', 'private-airi-token')
    const { initEnv } = await import('./config')
    initEnv()
    const serialized = JSON.stringify(withFields.mock.calls)
    expect(serialized).not.toMatch(/secret-openai-key|private-player-name|private-game-password|private-airi-token/)
    expect(serialized).toContain('openaiModelConfigured')
  })
})
