import type {
  ObjectivePerceptionSourceKind,
  PerceptionContextProjection,
  PerceptionSourceKind,
  PerceptionStateSnapshot,
  RuntimePerceptionFact,
} from './contracts'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'
import { allowedPerceptionEnumValuesByCategory } from './policy'

export interface CreatePerceptionContextProjectionOptions {
  facts: readonly RuntimePerceptionFact[]
  snapshot: PerceptionStateSnapshot
  now: number
  maxFacts?: number
  maxCharacters?: number
  createId?: (snapshot: PerceptionStateSnapshot) => string
}

const DEFAULT_MAX_FACTS = 4
const DEFAULT_MAX_CHARACTERS = 640

const sourceLabels: Record<ObjectivePerceptionSourceKind, string> = {
  'screen-local': 'local-screen',
  'screen-cloud': 'cloud-screen',
  'camera-local': 'local-camera',
  'camera-cloud': 'cloud-camera',
  'minecraft': 'minecraft',
}

const categoryPriority: Readonly<Record<string, number>> = {
  'minecraft.threat': 100,
  'screen.health': 90,
  'camera.health': 90,
  'minecraft.health': 90,
  'person.presence': 80,
  'person.count': 75,
  'screen.activity': 70,
  'screen.application': 65,
  'screen.window': 60,
  'person.gesture': 55,
  'person.pose': 50,
  'person.observable-cue': 45,
  'object.presence': 42,
  'person.activity-like': 40,
  'environment.lighting': 35,
  'environment.scene': 30,
  'minecraft.player': 25,
  'minecraft.task': 20,
}

/**
 * Projects fresh accepted facts into bounded, controlled statements.
 *
 * Summary-valued facts are deliberately omitted: even bounded model text can
 * carry prompt-injection instructions. Only allowlisted enums, booleans and
 * bounded person counts are converted through fixed templates.
 */
export function createPerceptionContextProjection(
  options: CreatePerceptionContextProjectionOptions,
): PerceptionContextProjection | null {
  const maxFacts = clampInteger(options.maxFacts ?? DEFAULT_MAX_FACTS, 1, 16)
  const maxCharacters = clampInteger(options.maxCharacters ?? DEFAULT_MAX_CHARACTERS, 1, 4_000)
  const acceptedIds = new Set(options.snapshot.acceptedFactIds)
  const candidates = options.facts
    .filter(fact => isProjectionCandidate(fact, options.snapshot, acceptedIds, options.now))
    .map(fact => ({ fact, statement: formatControlledStatement(fact) }))
    .filter((entry): entry is { fact: RuntimePerceptionFact, statement: string } => entry.statement !== undefined)
    .sort((left, right) => projectionScore(right.fact, options.now) - projectionScore(left.fact, options.now)
      || right.fact.observedAt - left.fact.observedAt
      || left.fact.factId.localeCompare(right.fact.factId))

  const selected: Array<{ fact: RuntimePerceptionFact, statement: string }> = []
  let usedCharacters = 0
  for (const candidate of candidates) {
    if (selected.length >= maxFacts)
      break
    const separatorLength = selected.length === 0 ? 0 : 1
    if (usedCharacters + separatorLength + candidate.statement.length > maxCharacters)
      continue
    selected.push(candidate)
    usedCharacters += separatorLength + candidate.statement.length
  }

  if (selected.length === 0)
    return null

  const sources = [...new Set(selected.map(({ fact }) => sourceLabels[fact.source.kind]))].sort()
  return {
    contractVersion: PERCEPTION_CONTRACT_VERSION,
    projectionId: options.createId?.(options.snapshot) ?? `projection:${options.snapshot.snapshotId}`,
    factIds: selected.map(({ fact }) => fact.factId),
    createdAt: options.now,
    expiresAt: Math.min(...selected.map(({ fact }) => fact.expiresAt)),
    sourceSummary: sources.join(','),
    statements: selected.map(({ statement }) => statement),
    maxCharacters,
    maxFacts,
  }
}

/**
 * Revalidates a projection before it crosses a renderer boundary. Schema-valid
 * bounded strings are still untrusted unless they match the fixed templates
 * emitted by this module.
 */
export function isControlledPerceptionContextProjection(
  projection: PerceptionContextProjection,
  sourceKind: PerceptionSourceKind,
): boolean {
  if (projection.factIds.length !== projection.statements.length)
    return false

  const allowedSourceSummaries: Record<PerceptionSourceKind, readonly string[]> = {
    screen: ['local-screen', 'cloud-screen'],
    camera: ['local-camera', 'cloud-camera'],
    minecraft: ['minecraft'],
  }
  if (!allowedSourceSummaries[sourceKind].includes(projection.sourceSummary))
    return false

  return projection.statements.every(statement => isControlledStatement(statement, sourceKind))
}

function isControlledStatement(statement: string, sourceKind: PerceptionSourceKind): boolean {
  if (sourceKind === 'screen') {
    return matchesEnumTemplate(statement, 'screen.activity', 'Current screen activity is classified as ')
      || matchesEnumTemplate(statement, 'screen.application', 'The current application class is ')
      || matchesEnumTemplate(statement, 'screen.window', 'The current window arrangement is ')
      || matchesEnumTemplate(statement, 'screen.health', 'Screen capture status is ')
  }

  if (sourceKind === 'minecraft') {
    return statement === 'Minecraft reports a nearby threat.'
      || statement === 'Minecraft reports no nearby threat.'
      || matchesEnumTemplate(statement, 'minecraft.health', 'Minecraft connection status is ')
      || matchesEnumTemplate(statement, 'minecraft.player', 'Minecraft player status is ')
      || matchesEnumTemplate(statement, 'minecraft.task', 'Minecraft task status is ')
      || matchesEnumTemplate(statement, 'minecraft.threat', 'Minecraft nearby threat level is ')
  }

  if (statement === 'A person is currently visible in the camera view.'
    || statement === 'No person is currently visible in the camera view.'
    || statement === 'An allowlisted object is currently visible.'
    || statement === 'No allowlisted object is currently visible.') {
    return true
  }

  const personCount = /^The camera currently observes (\d{1,2}) persons?\.$/.exec(statement)
  if (personCount) {
    const count = Number(personCount[1])
    if (count >= 0 && count <= 16)
      return statement === `The camera currently observes ${count} person${count === 1 ? '' : 's'}.`
  }

  return matchesEnumTemplate(statement, 'person.pose', 'The observable pose is ')
    || matchesEnumTemplate(statement, 'person.gesture', 'The observable gesture is ')
    || matchesEnumTemplate(statement, 'person.observable-cue', 'An observable ', ' visual cue is present; this does not establish emotion, health, identity, or intent.')
    || matchesEnumTemplate(statement, 'person.activity-like', 'An observable ', ' activity-like pattern is present; this is not a psychological or health conclusion.')
    || matchesEnumTemplate(statement, 'environment.lighting', 'Camera lighting is classified as ')
    || matchesEnumTemplate(statement, 'environment.scene', 'The camera scene is classified as ')
    || matchesEnumTemplate(statement, 'object.presence', 'An allowlisted ', ' is currently visible in the camera view.')
    || matchesEnumTemplate(statement, 'camera.health', 'Camera capture status is ')
}

function matchesEnumTemplate(statement: string, category: string, prefix: string, suffix = '.'): boolean {
  const allowlist = allowedPerceptionEnumValuesByCategory[category]
  return allowlist?.some(value => statement === `${prefix}${value}${suffix}`) ?? false
}

function isProjectionCandidate(
  fact: RuntimePerceptionFact,
  snapshot: PerceptionStateSnapshot,
  acceptedIds: ReadonlySet<string>,
  now: number,
): boolean {
  if (fact.state !== 'accepted' || !acceptedIds.has(fact.factId))
    return false
  if (fact.sessionId !== snapshot.sessionId || fact.generation !== snapshot.generation)
    return false
  if (fact.expiresAt <= now || fact.observedAt > now)
    return false
  if (fact.sensitivity === 'prohibited')
    return false
  if (fact.sensitivity === 'sensitive')
    return false
  return true
}

function formatControlledStatement(fact: RuntimePerceptionFact): string | undefined {
  if (fact.value.kind === 'summary')
    return undefined

  if (fact.value.kind === 'boolean') {
    if (fact.category === 'person.presence')
      return fact.value.value ? 'A person is currently visible in the camera view.' : 'No person is currently visible in the camera view.'
    if (fact.category === 'object.presence')
      return fact.value.value ? 'An allowlisted object is currently visible.' : 'No allowlisted object is currently visible.'
    if (fact.category === 'minecraft.threat')
      return fact.value.value ? 'Minecraft reports a nearby threat.' : 'Minecraft reports no nearby threat.'
    return undefined
  }

  if (fact.value.kind === 'number') {
    if (fact.category !== 'person.count' || !Number.isInteger(fact.value.value) || fact.value.value < 0 || fact.value.value > 16)
      return undefined
    return `The camera currently observes ${fact.value.value} person${fact.value.value === 1 ? '' : 's'}.`
  }

  const allowlist = allowedPerceptionEnumValuesByCategory[fact.category]
  if (!allowlist?.includes(fact.value.value))
    return undefined

  const value = fact.value.value
  switch (fact.category) {
    case 'screen.activity': return `Current screen activity is classified as ${value}.`
    case 'screen.application': return `The current application class is ${value}.`
    case 'screen.window': return `The current window arrangement is ${value}.`
    case 'screen.health': return `Screen capture status is ${value}.`
    case 'person.pose': return `The observable pose is ${value}.`
    case 'person.gesture': return `The observable gesture is ${value}.`
    case 'person.observable-cue': return `An observable ${value} visual cue is present; this does not establish emotion, health, identity, or intent.`
    case 'person.activity-like': return `An observable ${value} activity-like pattern is present; this is not a psychological or health conclusion.`
    case 'environment.lighting': return `Camera lighting is classified as ${value}.`
    case 'environment.scene': return `The camera scene is classified as ${value}.`
    case 'object.presence': return `An allowlisted ${value} is currently visible in the camera view.`
    case 'camera.health': return `Camera capture status is ${value}.`
    case 'minecraft.health': return `Minecraft connection status is ${value}.`
    case 'minecraft.player': return `Minecraft player status is ${value}.`
    case 'minecraft.task': return `Minecraft task status is ${value}.`
    case 'minecraft.threat': return `Minecraft nearby threat level is ${value}.`
    default: return undefined
  }
}

function projectionScore(fact: RuntimePerceptionFact, now: number): number {
  const lifetime = Math.max(1, fact.expiresAt - fact.observedAt)
  const freshness = Math.max(0, Math.min(1, (fact.expiresAt - now) / lifetime))
  const verification = fact.verification === 'user-confirmed' ? 10 : fact.verification === 'direct-signal' ? 5 : 0
  return (categoryPriority[fact.category] ?? 0) + fact.confidence * 10 + freshness * 5 + verification
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value))
    return minimum
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
