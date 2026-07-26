import type { Card } from '@proj-airi/ccc'

import type { CharacterDraft, CharacterDraftLoreEntry, GroundedCharacterValue } from './contracts'

import { isGroundedValueAccepted } from './evidence'

export type CharacterDraftCompileErrorCode = 'missing_name' | 'unresolved_conflict'

/** Stable compilation failure raised before any Card store mutation. */
export class CharacterDraftCompileError extends Error {
  readonly code: CharacterDraftCompileErrorCode

  constructor(code: CharacterDraftCompileErrorCode) {
    super('Character draft cannot be compiled in its current review state.')
    this.name = 'CharacterDraftCompileError'
    this.code = code
  }
}

/** One deterministic, source-addressable character-only prompt section. */
export interface CharacterDraftCompiledPromptSection {
  id: string
  content: string
  sourceFactIds: string[]
}

function acceptedFactIds(draft: CharacterDraft): Set<string> {
  if (draft.conflicts.some(conflict => conflict.status === 'unresolved'))
    throw new CharacterDraftCompileError('unresolved_conflict')

  const rejected = new Set<string>()
  for (const conflict of draft.conflicts) {
    const selected = conflict.status === 'keep-both'
      ? new Set(conflict.factIds)
      : new Set(conflict.selectedFactIds)
    for (const factId of conflict.factIds) {
      if (conflict.status === 'discard-all' || !selected.has(factId))
        rejected.add(factId)
    }
  }
  const confirmedFactIds = new Set(draft.confirmedFactIds)
  return new Set(draft.facts
    .filter(fact => fact.evidenceValidation === 'verified' && !rejected.has(fact.factId))
    .filter(fact => fact.supportStatus === 'explicit'
      || (fact.supportStatus === 'inferred' && confirmedFactIds.has(fact.factId)))
    .map(fact => fact.factId))
}

function groundedValueAccepted(value: GroundedCharacterValue<string>, allowedFactIds: ReadonlySet<string>): boolean {
  if (value.origin === 'synthetic')
    return false
  if (!isGroundedValueAccepted(value))
    return false
  return !value.sourceFactIds?.length || value.sourceFactIds.some(factId => allowedFactIds.has(factId))
}

/** Compiles editable style fields without allowing source text to choose section order. */
export function compileDraftPromptSections(
  draft: CharacterDraft,
  allowedFactIds: ReadonlySet<string>,
): CharacterDraftCompiledPromptSection[] {
  const styleLines: string[] = []
  const styleFields: Array<[string, string[]]> = [
    ['语气', draft.languageStyle.tone],
    ['称谓', draft.languageStyle.addressTerms],
    ['人称', draft.languageStyle.pronouns],
    ['句式', draft.languageStyle.sentencePatterns],
    ['用词', draft.languageStyle.vocabulary],
    ['口头禅', draft.languageStyle.catchphrases],
    ['情绪表达', draft.languageStyle.emotionalExpression],
    ['避免表达', draft.languageStyle.prohibitedExpressions],
  ]
  for (const [label, values] of styleFields) {
    const normalized = values.map(value => value.trim()).filter(Boolean)
    if (normalized.length > 0)
      styleLines.push(`${label}：${normalized.join('、')}`)
  }
  if (styleLines.length === 0)
    return []

  const source = draft.promptSectionSources.find(section => section.sectionId === 'character.language-style')
  return [{
    id: 'character.language-style',
    content: `【角色说话方式】\n${styleLines.join('\n')}`,
    sourceFactIds: (source?.sourceFactIds ?? []).filter(factId => allowedFactIds.has(factId)),
  }]
}

/**
 * Compiles a reviewed draft into a neutral, non-activated Card. Only verified
 * evidence, explicitly confirmed inferences, and resolved conflict choices are
 * eligible. Temporary document/job identifiers never enter the Card.
 */
export function compileDraftToCard(draft: CharacterDraft): Card {
  const allowedFactIds = acceptedFactIds(draft)
  const acceptedValue = (value: GroundedCharacterValue<string> | undefined): string | undefined =>
    value && groundedValueAccepted(value, allowedFactIds) ? value.value.trim() || undefined : undefined
  const acceptedList = (values: GroundedCharacterValue<string>[]): string[] => values
    .filter(value => groundedValueAccepted(value, allowedFactIds))
    .map(value => value.value.trim())
    .filter(Boolean)
  const name = acceptedValue(draft.name)
  if (!name)
    throw new CharacterDraftCompileError('missing_name')

  const descriptionParts = [acceptedValue(draft.description)]
  const story = acceptedList(draft.story)
  const relationships = acceptedList(draft.relationships)
  if (story.length > 0)
    descriptionParts.push(`【背景故事】\n${story.join('\n')}`)
  if (relationships.length > 0)
    descriptionParts.push(`【人物关系】\n${relationships.join('\n')}`)

  const promptSections = compileDraftPromptSections(draft, allowedFactIds)

  const loreEntries = draft.loreEntries
    .filter(entry => entry.content.trim() && (entry.constant || entry.keys.length > 0))
    .filter(entry => entry.sourceFactIds.length === 0 || entry.sourceFactIds.some(factId => allowedFactIds.has(factId)))
    .map((entry: CharacterDraftLoreEntry, sourceIndex) => ({
      id: entry.draftEntryId,
      ...(entry.name !== undefined ? { name: entry.name } : {}),
      keys: entry.keys,
      ...(entry.secondaryKeys !== undefined ? { secondary_keys: entry.secondaryKeys } : {}),
      content: entry.content.trim(),
      enabled: true,
      insertion_order: entry.insertionOrder ?? sourceIndex,
      position: entry.position ?? 'after_char',
      ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
      constant: entry.constant ?? false,
      ...(entry.selective !== undefined ? { selective: entry.selective } : {}),
      ...(entry.useRegex !== undefined ? { use_regex: entry.useRegex } : {}),
      ...(entry.caseSensitive !== undefined ? { case_sensitive: entry.caseSensitive } : {}),
      extensions: {},
    }))

  const messageExample = acceptedList(draft.messageExamples)
    .map(value => [`{{char}}: ${value}` as const])
  const hasCharacterBook = loreEntries.length > 0
    || Object.values(draft.loreBook).some(value => value !== undefined)

  return {
    name,
    nickname: acceptedValue(draft.nickname),
    version: '1.0.0',
    description: descriptionParts.filter((value): value is string => Boolean(value)).join('\n\n'),
    personality: acceptedList(draft.personality).join('、'),
    scenario: acceptedValue(draft.scenario) ?? '',
    greetings: acceptedList(draft.greetings),
    messageExample,
    systemPrompt: promptSections.map(section => section.content).join('\n\n'),
    postHistoryInstructions: '',
    tags: [],
    characterBook: hasCharacterBook
      ? {
          ...(draft.loreBook.name !== undefined ? { name: draft.loreBook.name } : {}),
          ...(draft.loreBook.description !== undefined ? { description: draft.loreBook.description } : {}),
          ...(draft.loreBook.scanDepth !== undefined ? { scan_depth: draft.loreBook.scanDepth } : {}),
          ...(draft.loreBook.tokenBudget !== undefined ? { token_budget: draft.loreBook.tokenBudget } : {}),
          ...(draft.loreBook.recursiveScanning !== undefined ? { recursive_scanning: draft.loreBook.recursiveScanning } : {}),
          entries: loreEntries,
          extensions: {},
        }
      : undefined,
  }
}
