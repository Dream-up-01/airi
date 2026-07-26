import type { CharacterSourceAnalysisV1, CharacterSourceDocument } from './contracts'

import { describe, expect, it } from 'vitest'

import { isGroundedValueAccepted, verifyCharacterSourceAnalysis } from './evidence'

const document: CharacterSourceDocument = {
  schemaVersion: 1,
  documentId: 'source:01234567',
  displayName: 'character.txt',
  contentHash: '0123456789abcdef'.repeat(4),
  format: 'txt',
  blocks: [{
    blockId: 'block-00001',
    order: 0,
    kind: 'paragraph',
    text: '栖遥说：“我住在浮光镇北侧。”',
    sourceStart: 0,
    sourceEnd: 18,
  }],
}

function createAnalysis(): CharacterSourceAnalysisV1 {
  return {
    schemaVersion: 1,
    documentId: document.documentId,
    candidates: [{
      candidateId: 'candidate:qiyao',
      name: '栖遥',
      aliases: [],
      evidenceBlockIds: ['block-00001'],
      ambiguity: 'clear',
    }],
    facts: [{
      factId: 'fact:home',
      candidateId: 'candidate:qiyao',
      category: 'location',
      value: '住在浮光镇北侧',
      supportStatus: 'explicit',
      evidenceBlockIds: ['block-00001'],
      quote: '我住在浮光镇北侧。',
      evidenceValidation: 'unverified',
    }],
    conflicts: [],
    unclassifiedBlockIds: [],
  }
}

describe('character source evidence', () => {
  it('verifies exact excerpts with controlled punctuation normalization', () => {
    const analysis = createAnalysis()
    analysis.facts[0] = { ...analysis.facts[0]!, quote: '我住在浮光镇北侧.' }

    const result = verifyCharacterSourceAnalysis(analysis, document)

    expect(result.analysis.facts[0]?.evidenceValidation).toBe('verified')
    expect(result.issues).toEqual([])
  })

  it('rejects a quote that cannot be found in the declared block', () => {
    const analysis = createAnalysis()
    analysis.facts[0] = { ...analysis.facts[0]!, quote: '她从小一直住在浮光镇。' }

    const result = verifyCharacterSourceAnalysis(analysis, document)

    expect(result.analysis.facts[0]?.evidenceValidation).toBe('rejected')
    expect(result.issues).toEqual([{
      code: 'quote_not_found',
      factId: 'fact:home',
      evidenceBlockIds: ['block-00001'],
    }])
  })

  it('requires user confirmation for verified inferred values', () => {
    const inferred = {
      value: '谨慎',
      supportStatus: 'inferred' as const,
      evidenceBlockIds: ['block-00001'],
      quote: '我住在浮光镇北侧。',
      evidenceValidation: 'verified' as const,
      userConfirmed: false,
    }

    expect(isGroundedValueAccepted(inferred)).toBe(false)
    expect(isGroundedValueAccepted({ ...inferred, userConfirmed: true })).toBe(true)
  })

  it('rejects provider facts copied from a redaction placeholder', () => {
    const analysis = createAnalysis()
    const redactedDocument = {
      ...document,
      blocks: [{ ...document.blocks[0]!, text: '令牌：[REDACTED:credential]' }],
    }
    analysis.facts[0] = {
      ...analysis.facts[0]!,
      value: '[REDACTED:credential]',
      quote: '[REDACTED:credential]',
    }

    const result = verifyCharacterSourceAnalysis(analysis, redactedDocument)

    expect(result.analysis.facts[0]?.evidenceValidation).toBe('rejected')
    expect(result.issues[0]?.code).toBe('redacted_evidence')
  })

  it('rejects an obvious fact attribution to another discovered character', () => {
    const analysis = createAnalysis()
    analysis.candidates.push({
      candidateId: 'candidate:lin',
      name: '林澈',
      aliases: [],
      evidenceBlockIds: ['block-00002'],
      ambiguity: 'multiple-primary-candidates',
    })
    const mismatchedDocument = {
      ...document,
      blocks: [{ ...document.blocks[0]!, text: '林澈性格冲动。' }],
    }
    analysis.selectedCandidateId = 'candidate:qiyao'
    analysis.facts[0] = {
      ...analysis.facts[0]!,
      category: 'personality',
      value: '性格冲动',
      quote: '林澈性格冲动。',
    }

    const result = verifyCharacterSourceAnalysis(analysis, mismatchedDocument)

    expect(result.analysis.facts[0]?.evidenceValidation).toBe('rejected')
    expect(result.issues[0]?.code).toBe('subject_mismatch')
  })

  it('accepts confirmed user-authored draft values without fabricated evidence', () => {
    expect(isGroundedValueAccepted({
      value: '用户补充设定',
      supportStatus: 'explicit',
      evidenceBlockIds: [],
      quote: '',
      evidenceValidation: 'verified',
      userConfirmed: true,
      origin: 'user',
    })).toBe(true)
  })
})
