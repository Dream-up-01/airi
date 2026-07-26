import type { ContextMessage } from '../../../types/chat'

import { useMinecraftStore } from '../../modules/gaming-minecraft'
import { createPerceptionContextMessage } from './perception'

export const MINECRAFT_CONTEXT_ID = 'system:trusted-perception:minecraft'

export function createMinecraftContext(): ContextMessage | null {
  const minecraftStore = useMinecraftStore()
  minecraftStore.initialize()

  const projection = minecraftStore.getContextProjection()
  return projection ? createPerceptionContextMessage(projection, MINECRAFT_CONTEXT_ID) : null
}
