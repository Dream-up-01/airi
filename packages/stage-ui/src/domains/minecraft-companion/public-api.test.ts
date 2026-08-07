import {
  MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION,
  MINECRAFT_COMPANION_CONTRACT_VERSION,
  MinecraftIntentController,
} from '@proj-airi/stage-ui/domains/minecraft-companion'
import { describe, expect, it } from 'vitest'

describe('minecraft companion public package API', () => {
  it('exports the versioned contracts and intent controller', () => {
    expect(MINECRAFT_COMPANION_CONTRACT_VERSION).toBe('minecraft-companion/v1')
    expect(MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION).toBe('minecraft-agent-control/v1')
    expect(MinecraftIntentController).toBeTypeOf('function')
  })
})
