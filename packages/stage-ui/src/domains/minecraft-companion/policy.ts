import type {
  MinecraftActionAssessment,
  MinecraftActionPolicyContext,
  MinecraftAgentAction,
} from './contracts'

import {
  minecraftHighRiskActionKinds,
  minecraftLowRiskActionKinds,
  minecraftMediumRiskActionKinds,
  minecraftProhibitedActionKinds,
} from './contracts'
import { parseMinecraftAgentAction } from './schemas'

const lowRisk = new Set<string>(minecraftLowRiskActionKinds)
const mediumRisk = new Set<string>(minecraftMediumRiskActionKinds)
const highRisk = new Set<string>(minecraftHighRiskActionKinds)
const prohibited = new Set<string>(minecraftProhibitedActionKinds)

function getKind(input: unknown): string | undefined {
  if (!input || typeof input !== 'object')
    return undefined
  const kind = Reflect.get(input, 'kind')
  return typeof kind === 'string' ? kind : undefined
}

export function minecraftRiskClassForAction(action: MinecraftAgentAction): 'low' | 'medium' | 'high' {
  const kind = action.kind
  if (lowRisk.has(kind))
    return 'low'
  if (mediumRisk.has(kind))
    return 'medium'
  return highRisk.has(kind) ? 'high' : 'high'
}

export function assessMinecraftAction(input: unknown, context: MinecraftActionPolicyContext): MinecraftActionAssessment {
  const kind = getKind(input)
  if (kind && prohibited.has(kind))
    return { decision: 'reject', riskClass: 'prohibited', errorCode: kind === 'control-user-avatar' ? 'user-avatar-control-forbidden' : 'arbitrary-command-forbidden' }

  const parsed = parseMinecraftAgentAction(input)
  if (!parsed.success)
    return { decision: 'reject', riskClass: 'prohibited', errorCode: 'invalid-contract' }

  if (context.consent.serverProfileId !== context.serverProfileId)
    return { decision: 'reject', riskClass: 'prohibited', errorCode: 'server-profile-mismatch' }
  if (context.consent.revokedAt !== undefined)
    return { decision: 'reject', riskClass: 'prohibited', errorCode: 'consent-revoked' }
  if (!context.consent.allowVirtualPlayerJoin || context.consent.grantedAt > context.now)
    return { decision: 'reject', riskClass: 'prohibited', errorCode: 'consent-required' }

  const action = parsed.output as MinecraftAgentAction
  const riskClass = minecraftRiskClassForAction(action)
  if (!context.consent.allowedActionKinds.includes(action.kind))
    return { decision: 'reject', riskClass, errorCode: 'action-not-granted' }

  if (riskClass === 'low') {
    const explicitAutoList = context.consent.autoApproveActionKinds
    if (explicitAutoList && !explicitAutoList.includes(action.kind as typeof explicitAutoList[number]))
      return { decision: 'approval-required', riskClass }
    return { decision: 'auto', riskClass }
  }

  return { decision: 'approval-required', riskClass }
}
