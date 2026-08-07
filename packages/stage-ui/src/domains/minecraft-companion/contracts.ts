export const MINECRAFT_COMPANION_CONTRACT_VERSION = 'minecraft-companion/v1' as const
export const MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION = 'minecraft-agent-control/v1' as const

export const minecraftLowRiskActionKinds = [
  'look-at',
  'move-to-player',
  'follow-player',
  'jump',
  'send-chat',
  'select-hotbar',
] as const

export const minecraftMediumRiskActionKinds = [
  'craft',
  'navigate',
] as const

export const minecraftHighRiskActionKinds = [
  'attack',
  'break-block',
  'place-block',
  'give-item',
  'drop-item',
  'trade',
  'change-dimension',
  'use-held-item',
] as const

export const minecraftAgentActionKinds = [
  ...minecraftLowRiskActionKinds,
  ...minecraftMediumRiskActionKinds,
  ...minecraftHighRiskActionKinds,
] as const

export const minecraftProhibitedActionKinds = [
  'execute-command',
  'execute-code',
  'control-user-avatar',
  'credential-action',
] as const

export const minecraftActionRiskClasses = ['low', 'medium', 'high', 'prohibited'] as const
export const minecraftIntentStates = [
  'proposed',
  'awaiting-approval',
  'approved',
  'executing',
  'completed',
  'failed',
  'cancelled',
  'expired',
  'rejected',
] as const

export const minecraftStableErrorCodes = [
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
] as const

export type MinecraftActionKind = typeof minecraftAgentActionKinds[number]
export type MinecraftLowRiskActionKind = typeof minecraftLowRiskActionKinds[number]
export type MinecraftMediumRiskActionKind = typeof minecraftMediumRiskActionKinds[number]
export type MinecraftHighRiskActionKind = typeof minecraftHighRiskActionKinds[number]
export type MinecraftProhibitedActionKind = typeof minecraftProhibitedActionKinds[number]
export type MinecraftActionRiskClass = typeof minecraftActionRiskClasses[number]
export type MinecraftIntentState = typeof minecraftIntentStates[number]
export type MinecraftStableErrorCode = typeof minecraftStableErrorCodes[number]
export type MinecraftAuthMode = 'online' | 'offline' | 'custom-provider' | 'unknown'
export type MinecraftServerKind = 'official' | 'private' | 'lan' | 'third-party' | 'proxy' | 'unknown'
export type MinecraftRuntime = 'fabric' | 'vanilla' | 'forge' | 'neoforge' | 'unknown'

export interface MinecraftServerProfile {
  contractVersion: typeof MINECRAFT_COMPANION_CONTRACT_VERSION
  serverProfileId: string
  host: string
  port: number
  minecraftVersion: string
  runtime: MinecraftRuntime
  authMode: MinecraftAuthMode
  serverKind: MinecraftServerKind
  accountProfileId: string
  allowVirtualPlayerJoin: boolean
}

export interface MinecraftConsentGrant {
  contractVersion: typeof MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION
  grantId: string
  serverProfileId: string
  allowVirtualPlayerJoin: boolean
  allowedActionKinds: MinecraftActionKind[]
  autoApproveActionKinds?: MinecraftLowRiskActionKind[]
  grantedAt: number
  revokedAt?: number
  showPersistentIndicator: boolean
}

export interface MinecraftActionPosition {
  x: number
  y: number
  z: number
}

export type MinecraftAgentAction
  = | { kind: 'look-at', playerId: string }
    | { kind: 'move-to-player', playerId: string, radius: number }
    | { kind: 'follow-player', playerId: string, radius: number }
    | { kind: 'jump' }
    | { kind: 'send-chat', message: string }
    | { kind: 'select-hotbar', slot: number }
    | { kind: 'use-held-item', targetId?: string }
    | { kind: 'craft', recipeId: string, count: number }
    | { kind: 'navigate', destination: MinecraftActionPosition, radius: number }
    | { kind: 'attack', targetId: string }
    | { kind: 'break-block', position: MinecraftActionPosition }
    | { kind: 'place-block', position: MinecraftActionPosition, blockId: string }
    | { kind: 'give-item', playerId: string, itemId: string, count: number }
    | { kind: 'drop-item', itemId: string, count: number }
    | { kind: 'trade', playerId: string }
    | { kind: 'change-dimension', dimension: string }

export type MinecraftGoal = {
  contractVersion: typeof MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION
  goalId: string
  sessionId: string
  generation: number
  serverProfileId: string
  consentGrantId: string
  createdAt: number
  expiresAt: number
} & MinecraftAgentAction

export interface MinecraftActionProposal {
  contractVersion: typeof MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION
  intentId: string
  goalId: string
  sessionId: string
  generation: number
  serverProfileId: string
  consentGrantId: string
  action: MinecraftAgentAction
  riskClass: MinecraftActionRiskClass
  state: MinecraftIntentState
  createdAt: number
  expiresAt: number
  rejectionCode?: MinecraftStableErrorCode
}

export interface MinecraftActionResult {
  contractVersion: typeof MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION
  intentId: string
  goalId: string
  sessionId: string
  generation: number
  state: Extract<MinecraftIntentState, 'completed' | 'failed' | 'cancelled' | 'expired' | 'rejected'>
  completedAt: number
  errorCode?: MinecraftStableErrorCode
}

export interface MinecraftIntentSnapshot {
  sessionId: string
  generation: number
  intents: MinecraftActionProposal[]
}

export type MinecraftPolicyDecision = 'auto' | 'approval-required' | 'reject'

export interface MinecraftActionAssessment {
  decision: MinecraftPolicyDecision
  riskClass: MinecraftActionRiskClass
  errorCode?: MinecraftStableErrorCode
}

export interface MinecraftActionPolicyContext {
  serverProfileId: string
  consent: {
    grantId: string
    serverProfileId: string
    allowVirtualPlayerJoin: boolean
    allowedActionKinds: readonly MinecraftActionKind[]
    autoApproveActionKinds?: readonly MinecraftLowRiskActionKind[]
    grantedAt: number
    revokedAt?: number
  }
  now: number
}

export interface MinecraftIntentControllerOptions {
  sessionId: string
  generation: number
  now?: () => number
  maxIntentTtlMs?: number
}

export interface MinecraftActionExecutionContext {
  goalId: string
  sessionId: string
  generation: number
  serverProfileId: string
  intentId: string
  signal: AbortSignal
}
