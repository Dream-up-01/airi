import type { CharacterFact, CharacterSourceAnalysisV1 } from './contracts'

import { describe, expect, it } from 'vitest'

import { buildDraftFromReducerResult, reduceAnalysis } from './reducer'

function makeAnalysis(overrides?: Partial<CharacterSourceAnalysisV1>): CharacterSourceAnalysisV1 {
  return {
    schemaVersion: 1,
    documentId: 'doc-001',
    candidates: [{ candidateId: 'cand-001', name: '栖遥', aliases: [], evidenceBlockIds: ['block-00001'], ambiguity: 'clear' }],
    selectedCandidateId: 'cand-001',
    facts: [],
    conflicts: [],
    unclassifiedBlockIds: [],
    ...overrides,
  }
}

function makeFact(overrides?: Partial<CharacterFact>): CharacterFact {
  return {
    factId: 'fact-001',
    candidateId: 'cand-001',
    category: 'identity',
    value: '成年AI虚拟陪伴角色',
    supportStatus: 'explicit',
    evidenceBlockIds: ['block-00001'],
    quote: '成年AI虚拟陪伴角色',
    evidenceValidation: 'unverified',
    ...overrides,
  }
}

describe('reduceAnalysis', () => {
  it('deduplicates facts with the same category and normalised value', () => {
    const f1 = makeFact({ factId: 'f1', evidenceBlockIds: ['block-00001'] })
    const f2 = makeFact({ factId: 'f2', evidenceBlockIds: ['block-00002'] }) // same value
    const result = reduceAnalysis(makeAnalysis({ facts: [f1, f2] }))

    expect(result.facts).toHaveLength(1)
    expect(result.facts[0]!.evidenceBlockIds).toContain('block-00001')
    expect(result.facts[0]!.evidenceBlockIds).toContain('block-00002')
  })

  it('keeps facts with different values in the same category as separate', () => {
    const f1 = makeFact({ factId: 'f1', value: '温和' })
    const f2 = makeFact({ factId: 'f2', category: 'personality', value: '安静' })
    const result = reduceAnalysis(makeAnalysis({ facts: [f1, f2] }))

    expect(result.facts).toHaveLength(2)
  })

  it('detects exclusive conflicts for identity facts with different values', () => {
    const f1 = makeFact({ factId: 'f1', category: 'identity', value: '成年女性' })
    const f2 = makeFact({ factId: 'f2', category: 'identity', value: '成年男性' })
    const result = reduceAnalysis(makeAnalysis({ facts: [f1, f2] }))

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]!.status).toBe('unresolved')
    expect(result.conflicts[0]!.factIds).toContain('f1')
    expect(result.conflicts[0]!.factIds).toContain('f2')
  })

  it('does not add a conflict when analysis already contains one for those facts', () => {
    const f1 = makeFact({ factId: 'f1', category: 'identity', value: '成年女性' })
    const f2 = makeFact({ factId: 'f2', category: 'identity', value: '成年男性' })
    const existing = { conflictId: 'c1', category: 'identity' as const, factIds: ['f1', 'f2'], status: 'unresolved' as const, selectedFactIds: [] }
    const result = reduceAnalysis(makeAnalysis({ facts: [f1, f2], conflicts: [existing] }))

    expect(result.conflicts).toHaveLength(1)
  })

  it('lists blocks with no evidence as unclassified', () => {
    const f1 = makeFact({ evidenceBlockIds: ['block-00001'] })
    const result = reduceAnalysis(makeAnalysis({
      facts: [f1],
      unclassifiedBlockIds: ['block-00001', 'block-00002'],
    }))

    // block-00001 is claimed; block-00002 should remain unclassified.
    expect(result.unclassifiedBlockIds).toEqual(['block-00002'])
  })

  it('prefers explicit supportStatus when merging', () => {
    const f1 = makeFact({ factId: 'f1', supportStatus: 'inferred' })
    const f2 = makeFact({ factId: 'f2', supportStatus: 'explicit' }) // same value
    const result = reduceAnalysis(makeAnalysis({ facts: [f1, f2] }))

    expect(result.facts[0]!.supportStatus).toBe('explicit')
  })
})

describe('buildDraftFromReducerResult', () => {
  it('builds a draft with accepted name and personality fields', () => {
    const nameFact = makeFact({ factId: 'f1', category: 'identity', value: '栖遥' })
    const personalityFact = makeFact({ factId: 'f2', category: 'personality', value: '温和但不敷衍' })
    const reduced = reduceAnalysis(makeAnalysis({ facts: [nameFact, personalityFact] }))
    const draft = buildDraftFromReducerResult(reduced, 'doc-001', 'cand-001', '栖遥')

    expect(draft.schemaVersion).toBe(1)
    expect(draft.documentId).toBe('doc-001')
    expect(draft.selectedCandidateId).toBe('cand-001')
    expect(draft.personality).toHaveLength(1)
    expect(draft.personality[0]!.value).toBe('温和但不敷衍')
  })

  it('sets userConfirmed true for explicit facts, false for inferred', () => {
    const explicit = makeFact({ factId: 'f1', category: 'personality', value: '勇敢', supportStatus: 'explicit' })
    const inferred = makeFact({ factId: 'f2', category: 'personality', value: '谨慎', supportStatus: 'inferred' })
    const reduced = reduceAnalysis(makeAnalysis({ facts: [explicit, inferred] }))
    const draft = buildDraftFromReducerResult(reduced, 'doc-001', 'cand-001', '栖遥')

    const braveFact = draft.personality.find(g => g.value === '勇敢')
    const cautiousFact = draft.personality.find(g => g.value === '谨慎')
    expect(braveFact?.userConfirmed).toBe(true)
    expect(cautiousFact?.userConfirmed).toBe(false)
  })

  it('includes conflicts carried from the reducer', () => {
    const f1 = makeFact({ factId: 'f1', category: 'identity', value: '成年女性' })
    const f2 = makeFact({ factId: 'f2', category: 'identity', value: '成年男性' })
    const reduced = reduceAnalysis(makeAnalysis({ facts: [f1, f2] }))
    const draft = buildDraftFromReducerResult(reduced, 'doc-001', 'cand-001', '栖遥')

    expect(draft.conflicts).toHaveLength(1)
    expect(draft.conflicts[0]!.status).toBe('unresolved')
  })

  it('uses the grounded candidate name instead of an arbitrary identity fact', () => {
    const age = makeFact({ factId: 'f-age', predicate: 'age', value: '18 岁', evidenceValidation: 'verified' })
    const reduced = reduceAnalysis(makeAnalysis({ facts: [age] }))

    const draft = buildDraftFromReducerResult(reduced, 'doc-001', 'cand-001', '栖遥', ['block-00001'])

    expect(draft.name?.value).toBe('栖遥')
    expect(draft.description?.value).toBe('18 岁')
  })
})
