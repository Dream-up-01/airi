import {
  array,
  boolean,
  check,
  integer,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  picklist,
  pipe,
  regex,
  safeParse,
  strictObject,
  string,
  union,
} from 'valibot'

import {
  MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION,
  MINECRAFT_COMPANION_CONTRACT_VERSION,
  minecraftAgentActionKinds,
  minecraftHighRiskActionKinds,
  minecraftLowRiskActionKinds,
  minecraftMediumRiskActionKinds,
} from './contracts'

const identifier = pipe(string(), minLength(1), maxLength(160), regex(/^[a-z0-9][\w.:-]*$/iu))
const version = pipe(string(), minLength(1), maxLength(64), check(value => !containsControl(value)))
const timestamp = pipe(number(), integer(), minValue(0))
const boundedHost = pipe(string(), minLength(1), maxLength(253), regex(/^[a-z0-9][a-z0-9.-]*$/iu))

function containsControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1F || code === 0x7F)
      return true
  }
  return false
}

export const MinecraftServerProfileSchema = strictObject({
  contractVersion: literal(MINECRAFT_COMPANION_CONTRACT_VERSION),
  serverProfileId: identifier,
  host: boundedHost,
  port: pipe(number(), integer(), minValue(1), maxValue(65_535)),
  minecraftVersion: version,
  runtime: picklist(['fabric', 'vanilla', 'forge', 'neoforge', 'unknown']),
  authMode: picklist(['online', 'offline', 'custom-provider', 'unknown']),
  serverKind: picklist(['official', 'private', 'lan', 'third-party', 'proxy', 'unknown']),
  accountProfileId: identifier,
  allowVirtualPlayerJoin: boolean(),
})

const MinecraftConsentGrantBaseSchema = strictObject({
  contractVersion: literal(MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION),
  grantId: identifier,
  serverProfileId: identifier,
  allowVirtualPlayerJoin: boolean(),
  allowedActionKinds: pipe(array(picklist(minecraftAgentActionKinds)), minLength(1), maxLength(32)),
  autoApproveActionKinds: optional(pipe(array(picklist(minecraftLowRiskActionKinds)), maxLength(16))),
  grantedAt: timestamp,
  revokedAt: optional(timestamp),
  showPersistentIndicator: boolean(),
})

export const MinecraftConsentGrantSchema = pipe(
  MinecraftConsentGrantBaseSchema,
  check(value => value.revokedAt === undefined || value.revokedAt >= value.grantedAt),
  check(value => !value.autoApproveActionKinds?.some(kind => !value.allowedActionKinds.includes(kind))),
)

export const MinecraftServerFingerprintSchema = strictObject({
  serverProfileId: identifier,
  fingerprintId: identifier,
  observedAt: timestamp,
})

export const MinecraftActionRiskClassSchema = picklist(['low', 'medium', 'high', 'prohibited'])
export const MinecraftActionKindSchema = picklist(minecraftAgentActionKinds)
export const MinecraftHighRiskActionKindSchema = picklist(minecraftHighRiskActionKinds)
export const MinecraftMediumRiskActionKindSchema = picklist(minecraftMediumRiskActionKinds)

export function parseMinecraftServerProfile(input: unknown) {
  return safeParse(MinecraftServerProfileSchema, input)
}

export function parseMinecraftConsentGrant(input: unknown) {
  return safeParse(MinecraftConsentGrantSchema, input)
}

export function parseMinecraftServerFingerprint(input: unknown) {
  return safeParse(MinecraftServerFingerprintSchema, input)
}

export const MinecraftActionPositionSchema = strictObject({
  x: pipe(number(), integer(), minValue(-30_000_000), maxValue(30_000_000)),
  y: pipe(number(), integer(), minValue(-2_048), maxValue(2_048)),
  z: pipe(number(), integer(), minValue(-30_000_000), maxValue(30_000_000)),
})

const boundedText = pipe(string(), minLength(1), maxLength(256), check(value => !containsControl(value)))
const boundedCount = pipe(number(), integer(), minValue(1), maxValue(64))
const boundedRadius = pipe(number(), minValue(0.5), maxValue(64))
const lowRiskActionSet = new Set<string>(minecraftLowRiskActionKinds)
const mediumRiskActionSet = new Set<string>(minecraftMediumRiskActionKinds)
const highRiskActionSet = new Set<string>(minecraftHighRiskActionKinds)

export const MinecraftAgentActionSchema = union([
  strictObject({ kind: literal('look-at'), playerId: identifier }),
  strictObject({ kind: literal('move-to-player'), playerId: identifier, radius: boundedRadius }),
  strictObject({ kind: literal('follow-player'), playerId: identifier, radius: boundedRadius }),
  strictObject({ kind: literal('jump') }),
  strictObject({ kind: literal('send-chat'), message: boundedText }),
  strictObject({ kind: literal('select-hotbar'), slot: pipe(number(), integer(), minValue(0), maxValue(8)) }),
  strictObject({ kind: literal('use-held-item'), targetId: optional(identifier) }),
  strictObject({ kind: literal('craft'), recipeId: identifier, count: boundedCount }),
  strictObject({ kind: literal('navigate'), destination: MinecraftActionPositionSchema, radius: boundedRadius }),
  strictObject({ kind: literal('attack'), targetId: identifier }),
  strictObject({ kind: literal('break-block'), position: MinecraftActionPositionSchema }),
  strictObject({ kind: literal('place-block'), position: MinecraftActionPositionSchema, blockId: identifier }),
  strictObject({ kind: literal('give-item'), playerId: identifier, itemId: identifier, count: boundedCount }),
  strictObject({ kind: literal('drop-item'), itemId: identifier, count: boundedCount }),
  strictObject({ kind: literal('trade'), playerId: identifier }),
  strictObject({ kind: literal('change-dimension'), dimension: identifier }),
])

const goalCommon = {
  contractVersion: literal(MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION),
  goalId: identifier,
  sessionId: identifier,
  generation: pipe(number(), integer(), minValue(0)),
  serverProfileId: identifier,
  consentGrantId: identifier,
  createdAt: timestamp,
  expiresAt: timestamp,
}

export const MinecraftGoalSchema = union([
  strictObject({ ...goalCommon, kind: literal('look-at'), playerId: identifier }),
  strictObject({ ...goalCommon, kind: literal('move-to-player'), playerId: identifier, radius: boundedRadius }),
  strictObject({ ...goalCommon, kind: literal('follow-player'), playerId: identifier, radius: boundedRadius }),
  strictObject({ ...goalCommon, kind: literal('jump') }),
  strictObject({ ...goalCommon, kind: literal('send-chat'), message: boundedText }),
  strictObject({ ...goalCommon, kind: literal('select-hotbar'), slot: pipe(number(), integer(), minValue(0), maxValue(8)) }),
  strictObject({ ...goalCommon, kind: literal('use-held-item'), targetId: optional(identifier) }),
  strictObject({ ...goalCommon, kind: literal('craft'), recipeId: identifier, count: boundedCount }),
  strictObject({ ...goalCommon, kind: literal('navigate'), destination: MinecraftActionPositionSchema, radius: boundedRadius }),
  strictObject({ ...goalCommon, kind: literal('attack'), targetId: identifier }),
  strictObject({ ...goalCommon, kind: literal('break-block'), position: MinecraftActionPositionSchema }),
  strictObject({ ...goalCommon, kind: literal('place-block'), position: MinecraftActionPositionSchema, blockId: identifier }),
  strictObject({ ...goalCommon, kind: literal('give-item'), playerId: identifier, itemId: identifier, count: boundedCount }),
  strictObject({ ...goalCommon, kind: literal('drop-item'), itemId: identifier, count: boundedCount }),
  strictObject({ ...goalCommon, kind: literal('trade'), playerId: identifier }),
  strictObject({ ...goalCommon, kind: literal('change-dimension'), dimension: identifier }),
])

const MinecraftActionProposalBaseSchema = strictObject({
  contractVersion: literal(MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION),
  intentId: identifier,
  goalId: identifier,
  sessionId: identifier,
  generation: pipe(number(), integer(), minValue(0)),
  serverProfileId: identifier,
  consentGrantId: identifier,
  action: MinecraftAgentActionSchema,
  riskClass: picklist(['low', 'medium', 'high', 'prohibited']),
  state: picklist(['proposed', 'awaiting-approval', 'approved', 'executing', 'completed', 'failed', 'cancelled', 'expired', 'rejected']),
  createdAt: timestamp,
  expiresAt: timestamp,
  rejectionCode: optional(picklist([
    'invalid-contract',
    'session-mismatch',
    'stale-generation',
    'goal-expired',
    'action-expired',
    'duplicate-intent',
    'action-not-granted',
    'approval-required',
    'invalid-transition',
    'consent-required',
    'consent-revoked',
    'server-profile-invalid',
    'server-profile-mismatch',
    'server-auth-required',
    'server-auth-failed',
    'server-version-unsupported',
    'virtual-player-rejected',
    'server-plugin-required',
    'control-denied',
    'action-cancelled',
    'arbitrary-command-forbidden',
    'user-avatar-control-forbidden',
    'server-untrusted',
    'virtual-player-conflict',
    'source-disconnected',
    'unknown',
  ])),
})

export const MinecraftActionProposalSchema = pipe(
  MinecraftActionProposalBaseSchema,
  check((value) => {
    const expectedRisk = lowRiskActionSet.has(value.action.kind)
      ? 'low'
      : mediumRiskActionSet.has(value.action.kind)
        ? 'medium'
        : highRiskActionSet.has(value.action.kind)
          ? 'high'
          : undefined
    return expectedRisk === value.riskClass && value.expiresAt > value.createdAt
  }),
)

export function parseMinecraftGoal(input: unknown) {
  return safeParse(MinecraftGoalSchema, input)
}

export function parseMinecraftAgentAction(input: unknown) {
  return safeParse(MinecraftAgentActionSchema, input)
}

export function parseMinecraftActionProposal(input: unknown) {
  return safeParse(MinecraftActionProposalSchema, input)
}
