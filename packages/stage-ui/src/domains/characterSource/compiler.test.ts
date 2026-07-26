import type { CharacterDraft, CharacterFact, GroundedCharacterValue } from './contracts'

import { validateCharacterBook } from '@proj-airi/ccc'
import { describe, expect, it } from 'vitest'

import { CharacterDraftCompileError, compileDraftPromptSections, compileDraftToCard } from './compiler'

function fact(overrides: Partial<CharacterFact> = {}): CharacterFact {
  return {
    factId: 'fact-001',
    candidateId: 'cand-001',
    category: 'identity',
    predicate: 'identity',
    value: '栖遥',
    supportStatus: 'explicit',
    evidenceBlockIds: ['block-00001'],
    quote: '栖遥',
    evidenceValidation: 'verified',
    ...overrides,
  }
}

function grounded(value: string, overrides: Partial<GroundedCharacterValue<string>> = {}): GroundedCharacterValue<string> {
  return {
    value,
    supportStatus: 'explicit',
    evidenceBlockIds: ['block-00001'],
    quote: value,
    evidenceValidation: 'verified',
    userConfirmed: true,
    origin: 'source',
    sourceFactIds: ['fact-001'],
    ...overrides,
  }
}

function makeDraft(overrides: Partial<CharacterDraft> = {}): CharacterDraft {
  return {
    schemaVersion: 1,
    draftId: 'draft-001',
    documentId: 'doc-001',
    selectedCandidateId: 'cand-001',
    name: grounded('栖遥'),
    description: grounded('成年 AI 虚拟陪伴角色。'),
    story: [grounded('她在浮光镇长大。')],
    relationships: [grounded('与馆长是旧友。')],
    personality: [grounded('温和但不敷衍')],
    scenario: undefined,
    languageStyle: {
      tone: ['温柔'],
      addressTerms: [],
      pronouns: ['她'],
      sentencePatterns: [],
      vocabulary: [],
      catchphrases: ['先坐一会儿吧'],
      emotionalExpression: [],
      prohibitedExpressions: [],
    },
    greetings: [grounded('你好。')],
    messageExamples: [grounded('先说说今天发生了什么。')],
    loreBook: {
      name: '浮光世界',
      description: '浮光镇设定',
      scanDepth: 6,
      tokenBudget: 512,
      recursiveScanning: true,
    },
    loreEntries: [{
      draftEntryId: 'lore-001',
      name: '旧图书馆',
      content: '旧图书馆位于浮光镇北侧。',
      keys: ['旧图书馆'],
      secondaryKeys: ['浮光镇'],
      selective: true,
      useRegex: false,
      caseSensitive: true,
      constant: false,
      priority: 80,
      insertionOrder: 4,
      position: 'before_char',
      sourceFactIds: ['fact-001'],
    }],
    facts: [fact()],
    confirmedFactIds: [],
    conflicts: [],
    unclassifiedBlockIds: [],
    unclassifiedExcerpts: [],
    promptSectionSources: [],
    blockingReasonCodes: [],
    exportWarningCodes: [],
    warningCodes: [],
    ...overrides,
  }
}

describe('compileDraftToCard', () => {
  it('compiles only verified, grounded fields and deterministic style sections', () => {
    const card = compileDraftToCard(makeDraft())

    expect(card.name).toBe('栖遥')
    expect(card.description).toContain('虚拟陪伴角色')
    expect(card.description).toContain('【背景故事】')
    expect(card.description).toContain('【人物关系】')
    expect(card.personality).toBe('温和但不敷衍')
    expect(card.greetings).toEqual(['你好。'])
    expect(card.messageExample).toEqual([['{{char}}: 先说说今天发生了什么。']])
    expect(card.systemPrompt).toContain('语气：温柔')
  })

  it('returns deterministic style sections with only accepted source fact IDs', () => {
    const draft = makeDraft({
      promptSectionSources: [{ sectionId: 'character.language-style', sourceFactIds: ['fact-001', 'fact-rejected'] }],
    })

    expect(compileDraftPromptSections(draft, new Set(['fact-001']))).toEqual([{
      id: 'character.language-style',
      content: '【角色说话方式】\n语气：温柔\n人称：她\n口头禅：先坐一会儿吧',
      sourceFactIds: ['fact-001'],
    }])
  })

  it('excludes rejected, ambiguous, unconfirmed inferred, and synthetic values', () => {
    const inferredFact = fact({ factId: 'fact-inferred', supportStatus: 'inferred', value: '已确认推断' })
    const card = compileDraftToCard(makeDraft({
      facts: [fact(), inferredFact],
      confirmedFactIds: ['fact-inferred'],
      personality: [
        grounded('证据被拒绝', { evidenceValidation: 'rejected' }),
        grounded('存在歧义', { supportStatus: 'ambiguous' }),
        grounded('未经确认', { supportStatus: 'inferred', userConfirmed: false }),
        grounded('模型合成', { origin: 'synthetic' }),
        grounded('已确认推断', { supportStatus: 'inferred', userConfirmed: true, sourceFactIds: ['fact-inferred'] }),
      ],
    }))

    expect(card.personality).toBe('已确认推断')
  })

  it('includes explicit user edits without inventing source evidence', () => {
    const card = compileDraftToCard(makeDraft({
      name: grounded('用户命名', {
        origin: 'user',
        evidenceBlockIds: [],
        quote: '',
        sourceFactIds: [],
      }),
    }))

    expect(card.name).toBe('用户命名')
  })

  it('applies conflict decisions to every field and lore entry using source fact IDs', () => {
    const discarded = fact({ factId: 'fact-discarded', value: '错误身份' })
    const kept = fact({ factId: 'fact-kept', value: '正确身份' })
    const card = compileDraftToCard(makeDraft({
      facts: [discarded, kept],
      name: grounded('用户保留名', { origin: 'user', evidenceBlockIds: [], quote: '', sourceFactIds: [] }),
      personality: [grounded('错误身份', { sourceFactIds: ['fact-discarded'] })],
      description: grounded('正确身份', { sourceFactIds: ['fact-kept'] }),
      conflicts: [{
        conflictId: 'conflict-identity-1',
        category: 'identity',
        factIds: ['fact-discarded', 'fact-kept'],
        status: 'keep-one',
        selectedFactIds: ['fact-kept'],
      }],
    }))

    expect(card.name).toBe('用户保留名')
    expect(card.personality).toBe('')
    expect(card.description).toBe('正确身份')
  })

  it('rejects a nameless draft instead of inventing a placeholder fact', () => {
    expect(() => compileDraftToCard(makeDraft({ name: undefined }))).toThrowError(expect.objectContaining({ code: 'missing_name' }))
  })

  it('does not compile inferred lore until its source fact is explicitly confirmed', () => {
    const inferred = fact({ factId: 'fact-lore', category: 'world-rule', supportStatus: 'inferred' })
    const draft = makeDraft({
      facts: [fact(), inferred],
      loreEntries: [{
        draftEntryId: 'lore-inferred',
        content: '推断出的世界规则',
        keys: [],
        constant: true,
        sourceFactIds: ['fact-lore'],
      }],
    })

    expect(compileDraftToCard(draft).characterBook?.entries).toEqual([])
    expect(compileDraftToCard({ ...draft, confirmedFactIds: ['fact-lore'] }).characterBook?.entries).toHaveLength(1)
  })

  it('rejects unresolved conflicts before creating a card', () => {
    const draft = makeDraft({
      conflicts: [{
        conflictId: 'conflict-identity-1',
        category: 'identity',
        factIds: ['fact-001', 'fact-002'],
        status: 'unresolved',
        selectedFactIds: [],
      }],
    })

    expect(() => compileDraftToCard(draft)).toThrow(CharacterDraftCompileError)
  })

  it('preserves the complete reviewed CCv3 lore trigger configuration', () => {
    const entry = compileDraftToCard(makeDraft()).characterBook?.entries[0]

    expect(entry).toMatchObject({
      id: 'lore-001',
      secondary_keys: ['浮光镇'],
      selective: true,
      use_regex: false,
      case_sensitive: true,
      priority: 80,
      insertion_order: 4,
      position: 'before_char',
    })
    expect(compileDraftToCard(makeDraft()).characterBook).toMatchObject({
      name: '浮光世界',
      description: '浮光镇设定',
      scan_depth: 6,
      token_budget: 512,
      recursive_scanning: true,
    })
  })

  it('omits undefined optional lorebook values before Card storage validation', () => {
    const card = compileDraftToCard(makeDraft({
      loreBook: {},
      loreEntries: [{
        draftEntryId: 'lore-minimal',
        content: '最小世界书条目。',
        keys: ['最小条目'],
        constant: false,
        sourceFactIds: ['fact-001'],
      }],
    }))

    expect(card.characterBook).toEqual({
      entries: [{
        id: 'lore-minimal',
        keys: ['最小条目'],
        content: '最小世界书条目。',
        enabled: true,
        insertion_order: 0,
        position: 'after_char',
        constant: false,
        extensions: {},
      }],
      extensions: {},
    })
    expect(validateCharacterBook(card.characterBook).success).toBe(true)
  })

  it('does not export document, draft, job, hash, or local-path provenance', () => {
    const serialized = JSON.stringify(compileDraftToCard(makeDraft()))

    expect(serialized).not.toContain('doc-001')
    expect(serialized).not.toContain('draft-001')
    expect(serialized).not.toMatch(/job|contentHash|[A-Z]:\\\\Users/u)
  })
})
