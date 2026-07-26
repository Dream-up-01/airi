import type {
  CharacterConflict,
  CharacterDraft,
  CharacterFact,
  CharacterSourceAnalysisV1,
} from './contracts'

import { nanoid } from 'nanoid'

function conflictCategory(fact: CharacterFact): CharacterConflict['category'] | undefined {
  const predicate = fact.predicate?.toLocaleLowerCase('und') ?? ''
  if (predicate.includes('age'))
    return 'age'
  if (predicate.includes('timeline') || predicate.includes('time'))
    return 'timeline'
  if (predicate.includes('attitude'))
    return 'attitude'
  if (fact.category === 'identity')
    return 'identity'
  if (fact.category === 'relationship')
    return 'relationship'
  if (fact.category === 'ability')
    return 'ability'
  if (fact.category === 'world-rule')
    return 'world-rule'
  return undefined
}

/**
 * Deduplication key: category + normalised value.
 * Facts with the same key from different blocks are merged into one,
 * accumulating their evidence.
 */
function dedupeKey(fact: CharacterFact): string {
  return `${fact.candidateId ?? ''}:${fact.category}:${fact.predicate ?? fact.category}:${fact.value.trim().toLocaleLowerCase('und')}`
}

function mergeFacts(primary: CharacterFact, duplicate: CharacterFact): CharacterFact {
  const mergedBlockIds = Array.from(new Set([...primary.evidenceBlockIds, ...duplicate.evidenceBlockIds]))
  // Keep the higher-confidence support status: explicit > inferred > ambiguous.
  const statusRank = { explicit: 2, inferred: 1, ambiguous: 0 } as const
  const betterStatus = statusRank[primary.supportStatus] >= statusRank[duplicate.supportStatus]
    ? primary.supportStatus
    : duplicate.supportStatus
  return {
    ...primary,
    evidenceBlockIds: mergedBlockIds as [string, ...string[]],
    supportStatus: betterStatus,
  }
}

// ─── Public reducer ───────────────────────────────────────────────────────────

export interface ReducerResult {
  /** Deduplicated facts ready for draft compilation. */
  facts: CharacterFact[]
  /** Mutually exclusive fact pairs requiring user resolution. */
  conflicts: CharacterConflict[]
  /** Block IDs not claimed by any extracted fact. */
  unclassifiedBlockIds: string[]
}

/**
 * Merges extraction facts into a deduplicated set, detecting conflicts.
 *
 * - Facts with identical category + normalised value are merged (evidence union).
 * - Facts in exclusive categories with different values generate a CharacterConflict.
 * - Block IDs not referenced by any fact are listed as unclassified.
 * - The reducer never silently picks a winner; all conflicts require explicit user resolution.
 */
export function reduceAnalysis(analysis: CharacterSourceAnalysisV1): ReducerResult {
  const candidateId = analysis.selectedCandidateId
  const relevantFacts = candidateId
    ? analysis.facts.filter(f => f.candidateId === candidateId || !f.candidateId)
    : analysis.facts

  // Dedup pass: merge facts with the same category+value.
  const dedupMap = new Map<string, CharacterFact>()
  for (const fact of relevantFacts) {
    const key = dedupeKey(fact)
    const existing = dedupMap.get(key)
    if (existing)
      dedupMap.set(key, mergeFacts(existing, fact))
    else
      dedupMap.set(key, fact)
  }
  const dedupedFacts = Array.from(dedupMap.values())

  // Conflicts are grouped by atomic predicate. Grouping avoids pairwise
  // conflicts that silently omit a third contradictory value.
  const conflicts: CharacterConflict[] = [...analysis.conflicts]
  const existingConflictFacts = new Set(conflicts.flatMap(conflict => conflict.factIds))
  const groups = new Map<string, CharacterFact[]>()
  for (const fact of dedupedFacts) {
    const category = conflictCategory(fact)
    if (!category || fact.evidenceValidation === 'rejected' || existingConflictFacts.has(fact.factId))
      continue
    const key = `${fact.candidateId ?? ''}:${category}:${fact.predicate ?? fact.category}`
    groups.set(key, [...(groups.get(key) ?? []), fact])
  }
  let conflictIndex = 0
  for (const key of [...groups.keys()].sort()) {
    const facts = groups.get(key)!
    const distinctValues = new Set(facts.map(fact => fact.value.trim().toLocaleLowerCase('und')))
    if (facts.length < 2 || distinctValues.size < 2)
      continue
    const category = conflictCategory(facts[0]!) ?? 'other'
    conflicts.push({
      conflictId: `conflict:${category}:${conflictIndex++}`,
      category,
      factIds: facts.map(fact => fact.factId),
      status: 'unresolved',
      selectedFactIds: [],
    })
  }

  // Unclassified blocks: blocks not referenced by any fact.
  const claimedBlockIds = new Set(dedupedFacts.flatMap(f => f.evidenceBlockIds))
  const unclassifiedBlockIds = analysis.unclassifiedBlockIds.filter(id => !claimedBlockIds.has(id))

  return { facts: dedupedFacts, conflicts, unclassifiedBlockIds }
}

// ─── Draft builder ────────────────────────────────────────────────────────────

/**
 * Builds an initial CharacterDraft from reduced facts.
 * All inferred facts are marked userConfirmed: false until the user reviews them.
 * No data is invented beyond what is present in the facts.
 */
export function buildDraftFromReducerResult(
  result: ReducerResult,
  documentId: string,
  selectedCandidateId: string,
  candidateName: string,
  candidateEvidenceBlockIds: string[] = [],
  unclassifiedExcerpts: CharacterDraft['unclassifiedExcerpts'] = [],
): CharacterDraft {
  const groundedFact = (fact: CharacterFact) => ({
    value: fact.value,
    supportStatus: fact.supportStatus,
    evidenceBlockIds: fact.evidenceBlockIds,
    quote: fact.quote,
    evidenceValidation: fact.evidenceValidation,
    userConfirmed: fact.supportStatus === 'explicit',
    origin: 'source' as const,
    sourceFactIds: [fact.factId],
  })

  const firstGrounded = (facts: CharacterFact[], category: CharacterFact['category']) => {
    const match = facts.find(f => f.category === category && f.evidenceValidation !== 'rejected')
    return match ? groundedFact(match) : undefined
  }

  const multiGrounded = (facts: CharacterFact[], category: CharacterFact['category']) =>
    facts
      .filter(f => f.category === category && f.evidenceValidation !== 'rejected')
      .map(groundedFact)

  const dialogueFacts = result.facts.filter(f => f.category === 'dialogue')
  const candidateNameNormalized = candidateName.normalize('NFKC').trim().toLocaleLowerCase('und')
  const identityDetails = result.facts
    .filter(fact => fact.category === 'identity' && fact.evidenceValidation !== 'rejected')
    .filter((fact) => {
      const predicate = fact.predicate?.toLocaleLowerCase('und') ?? ''
      return !predicate.includes('name') && !predicate.includes('alias')
        && fact.value.normalize('NFKC').trim().toLocaleLowerCase('und') !== candidateNameNormalized
    })
    .map(groundedFact)
  const background = [...identityDetails, ...multiGrounded(result.facts, 'background')]

  const broadLoreKeys = new Set(['世界', '地方', '这里', '那里', '他', '她', '它', '我', '你'])
  const loreCategories = new Set<CharacterFact['category']>([
    'location',
    'organization',
    'npc',
    'history',
    'item',
    'ability',
    'world-rule',
  ])
  const loreEntries = result.facts
    .filter(fact => loreCategories.has(fact.category) && fact.evidenceValidation === 'verified')
    .map((fact, insertionOrder) => ({
      draftEntryId: `lore:${fact.factId}`,
      name: fact.entityNames?.[0],
      content: fact.value,
      keys: (fact.entityNames ?? []).filter(key => key.length >= 2 && !broadLoreKeys.has(key)),
      secondaryKeys: [],
      selective: false,
      useRegex: false,
      caseSensitive: false,
      constant: fact.category === 'world-rule' && (fact.entityNames?.length ?? 0) === 0,
      priority: 0,
      insertionOrder,
      position: 'after_char' as const,
      sourceFactIds: [fact.factId],
    }))
    .filter(entry => entry.constant || entry.keys.length > 0)

  const nicknameFact = result.facts.find((fact) => {
    const predicate = fact.predicate?.toLocaleLowerCase('und') ?? ''
    return fact.category === 'identity' && fact.evidenceValidation !== 'rejected'
      && (predicate.includes('nickname') || predicate.includes('alias'))
  })
  const name = candidateEvidenceBlockIds.length > 0
    ? {
        value: candidateName,
        supportStatus: 'explicit' as const,
        evidenceBlockIds: candidateEvidenceBlockIds,
        quote: candidateName,
        evidenceValidation: 'verified' as const,
        userConfirmed: true,
        origin: 'source' as const,
        sourceFactIds: [],
      }
    : undefined

  const promptCategories: Array<{ sectionId: string, categories: CharacterFact['category'][] }> = [
    { sectionId: 'character.identity', categories: ['identity'] },
    { sectionId: 'character.description', categories: ['background'] },
    { sectionId: 'character.personality', categories: ['personality'] },
    { sectionId: 'character.relationships', categories: ['relationship'] },
    { sectionId: 'character.scenario', categories: ['scenario'] },
    { sectionId: 'character.language-style', categories: ['language-style'] },
    { sectionId: 'character.examples', categories: ['dialogue'] },
  ]
  const promptSectionSources = promptCategories.map(({ sectionId, categories }) => ({
    sectionId,
    sourceFactIds: result.facts
      .filter(fact => categories.includes(fact.category) && fact.evidenceValidation !== 'rejected')
      .map(fact => fact.factId),
  })).filter(section => section.sourceFactIds.length > 0)

  const warningCodes: string[] = []
  if (result.facts.some(fact => fact.evidenceValidation === 'rejected'))
    warningCodes.push('rejected-evidence')
  if (result.facts.some(fact => fact.supportStatus === 'inferred'))
    warningCodes.push('unconfirmed-inferences')
  if (result.unclassifiedBlockIds.length > 0)
    warningCodes.push('unclassified-blocks')

  return {
    schemaVersion: 1,
    draftId: `draft:${nanoid()}`,
    documentId,
    selectedCandidateId,
    name,
    nickname: nicknameFact ? groundedFact(nicknameFact) : undefined,
    description: background[0],
    story: background.slice(1),
    relationships: multiGrounded(result.facts, 'relationship'),
    personality: multiGrounded(result.facts, 'personality'),
    scenario: firstGrounded(result.facts, 'scenario'),
    languageStyle: {
      tone: [],
      addressTerms: [],
      pronouns: [],
      sentencePatterns: [],
      vocabulary: [],
      catchphrases: multiGrounded(result.facts, 'language-style')
        .filter(value => value.evidenceValidation === 'verified' && value.supportStatus === 'explicit')
        .map(value => value.value),
      emotionalExpression: [],
      prohibitedExpressions: [],
    },
    greetings: [],
    messageExamples: dialogueFacts.slice(0, 16).map(f => ({
      value: f.value,
      supportStatus: f.supportStatus,
      evidenceBlockIds: f.evidenceBlockIds,
      quote: f.quote,
      evidenceValidation: f.evidenceValidation,
      userConfirmed: f.supportStatus === 'explicit',
      origin: 'source' as const,
      sourceFactIds: [f.factId],
    })),
    loreBook: {},
    loreEntries,
    facts: result.facts,
    confirmedFactIds: [],
    conflicts: result.conflicts,
    unclassifiedBlockIds: result.unclassifiedBlockIds,
    unclassifiedExcerpts,
    promptSectionSources,
    blockingReasonCodes: result.conflicts.some(conflict => conflict.status === 'unresolved') ? ['unresolved-conflicts'] : [],
    exportWarningCodes: [...warningCodes],
    warningCodes,
  }
}
