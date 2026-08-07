import type { MinecraftGoal, MinecraftStableErrorCode } from './contracts'

import { parseMinecraftGoal } from './schemas'

export const MINECRAFT_MAX_GOAL_TTL_MS = 120_000

export type MinecraftGoalCreationResult
  = | { ok: true, value: MinecraftGoal }
    | { ok: false, errorCode: MinecraftStableErrorCode }

export function createMinecraftGoal(input: unknown): MinecraftGoalCreationResult {
  const parsed = parseMinecraftGoal(input)
  if (!parsed.success)
    return { ok: false, errorCode: 'invalid-contract' }

  const goal = parsed.output as MinecraftGoal
  const ttl = goal.expiresAt - goal.createdAt
  if (ttl <= 0 || ttl > MINECRAFT_MAX_GOAL_TTL_MS)
    return { ok: false, errorCode: 'goal-expired' }

  return { ok: true, value: goal }
}
