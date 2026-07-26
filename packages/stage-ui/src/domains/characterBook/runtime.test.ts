import type { CharacterBook } from '@proj-airi/ccc'

import { describe, expect, it } from 'vitest'

import { compileCharacterBookPrompt, inspectCharacterBookCompatibility, selectCharacterBookEntries, summarizeCharacterBookWarnings } from './runtime'

function createBook(entries: CharacterBook['entries'], overrides: Partial<CharacterBook> = {}): CharacterBook {
  return {
    entries,
    extensions: {},
    ...overrides,
  }
}

function createEntry(id: string, overrides: Partial<CharacterBook['entries'][number]> = {}): CharacterBook['entries'][number] {
  return {
    id,
    keys: [],
    content: id,
    enabled: true,
    insertion_order: 0,
    extensions: {},
    ...overrides,
  }
}

describe('character book runtime', () => {
  it('returns a warning instead of throwing for malformed persisted lorebooks', () => {
    const result = selectCharacterBookEntries({
      book: { entries: [{ enabled: true }] } as never,
      conversation: ['anything'],
    })

    expect(result.beforeCharacter).toEqual([])
    expect(result.afterCharacter).toEqual([])
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'invalid_book' })])
  })

  it('selects constant and literal entries with selective secondary keys', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('constant', { constant: true, content: '核心世界规则。', position: 'before_char' }),
        createEntry('location', { keys: ['浮光镇'], content: '浮光镇终年多雾。', insertion_order: 2 }),
        createEntry('selective-hit', { keys: ['图书馆'], secondary_keys: ['北侧'], selective: true, insertion_order: 1 }),
        createEntry('selective-miss', { keys: ['图书馆'], secondary_keys: ['南侧'], selective: true }),
      ]),
      conversation: ['我们去浮光镇北侧的图书馆吧。'],
    })

    expect(result.beforeCharacter.map(entry => entry.entry.id)).toEqual(['constant'])
    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['selective-hit', 'location'])
  })

  it('discovers recursively referenced entries', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('a', { keys: ['入口'], content: '入口通向回声厅。' }),
        createEntry('b', { keys: ['回声厅'], content: '回声厅保存银钥匙。' }),
        createEntry('c', { keys: ['银钥匙'], content: '银钥匙属于馆长。' }),
      ], { recursive_scanning: true }),
      conversation: ['我站在入口。'],
    })

    expect(result.afterCharacter.map(entry => [entry.entry.id, entry.reason])).toEqual([
      ['a', 'keyword'],
      ['b', 'recursive-keyword'],
      ['c', 'recursive-keyword'],
    ])
  })

  it('rejects unbounded regular-expression keys', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('unsafe', { keys: ['(a+)+$'], use_regex: true }),
        createEntry('safe', { keys: ['^浮光镇.{0,4}北侧$'], use_regex: true }),
      ]),
      conversation: ['浮光镇在北侧'],
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['safe'])
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'unsafe_regex', entryId: 'unsafe' }))
  })

  it('reports unsupported primary and secondary triggers before runtime matching', () => {
    const warnings = inspectCharacterBookCompatibility(createBook([
      createEntry('empty', { keys: [''] }),
      createEntry('secondary', { keys: ['浮光镇'], secondary_keys: ['(a+)+$'], selective: true, use_regex: true }),
    ]))

    expect(warnings).toContainEqual(expect.objectContaining({ code: 'empty_key', entryId: 'empty' }))
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'unsafe_regex', entryId: 'secondary' }))
  })

  it('summarizes warnings without copying user-authored entry IDs or content into logs', () => {
    const summary = summarizeCharacterBookWarnings([{
      code: 'unsafe_regex',
      entryId: 'private-user-entry-id',
      message: 'bounded static remediation',
    }])

    expect(summary).toEqual({ unsafe_regex: 1 })
    expect(JSON.stringify(summary)).not.toContain('private-user-entry-id')
  })

  it('applies token budgets through an injected model tokenizer', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('low', { constant: true, content: '一二三四', priority: 1 }),
        createEntry('high', { constant: true, content: '五六七八', priority: 10 }),
      ], { token_budget: 4 }),
      conversation: [],
      countTokens: text => text.includes('一二三四') && text.includes('五六七八') ? 8 : 4,
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['high'])
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'token_budget_entry_discarded', entryId: 'low' }))
  })

  it('reports an unenforced token budget when no tokenizer is available', () => {
    const result = selectCharacterBookEntries({
      book: createBook([createEntry('constant', { constant: true })], { token_budget: 1 }),
      conversation: [],
    })

    expect(result.afterCharacter).toHaveLength(1)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'token_budget_requires_counter' }))
  })

  it('treats scan depth zero as no searchable history', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('constant', { constant: true }),
        createEntry('keyword', { keys: ['浮光镇'] }),
      ], { scan_depth: 0 }),
      conversation: ['浮光镇'],
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['constant'])
  })

  it('searches only the configured number of recent authored messages', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('old', { keys: ['旧地点'] }),
        createEntry('recent', { keys: ['新地点'] }),
      ], { scan_depth: 1 }),
      conversation: ['旧地点', '新地点'],
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['recent'])
  })

  it('respects case-sensitive literal matching', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('sensitive', { keys: ['AIRI'], case_sensitive: true }),
        createEntry('insensitive', { keys: ['AIRI'], case_sensitive: false }),
      ]),
      conversation: ['airi'],
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['insensitive'])
  })

  it('prunes after matching so later high-priority entries survive hard limits', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('low', { constant: true, priority: 1 }),
        createEntry('high', { constant: true, priority: 100 }),
      ]),
      conversation: [],
      limits: { maxSelectedEntries: 1 },
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['high'])
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'entry_limit_reached', entryId: 'low' }))
  })

  it('bounds candidate inspection and skips empty or overly broad keys', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('empty', { keys: [''] }),
        createEntry('broad', { keys: ['他'] }),
        createEntry('outside', { constant: true }),
      ]),
      conversation: ['他'],
      limits: { maxCandidateEntries: 2 },
    })

    expect(result.afterCharacter).toHaveLength(0)
    expect(result.warnings.map(warning => warning.code)).toEqual([
      'candidate_limit_reached',
      'empty_key',
      'overly_broad_key',
    ])
  })

  it('does not let source order exclude a later high-priority candidate', () => {
    const result = selectCharacterBookEntries({
      book: createBook([
        createEntry('early-low', { constant: true, priority: 1 }),
        createEntry('middle-low', { constant: true, priority: 2 }),
        createEntry('late-high', { constant: true, priority: 100 }),
      ]),
      conversation: [],
      limits: { maxCandidateEntries: 2 },
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toContain('late-high')
    expect(result.afterCharacter.map(entry => entry.entry.id)).not.toContain('early-low')
  })

  it('returns the hard-limited selection when the tokenizer fails', () => {
    const result = selectCharacterBookEntries({
      book: createBook([createEntry('constant', { constant: true })], { token_budget: 8 }),
      conversation: [],
      countTokens: () => { throw new Error('tokenizer unavailable') },
    })

    expect(result.afterCharacter.map(entry => entry.entry.id)).toEqual(['constant'])
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'token_counter_failed' }))
  })

  it('compiles position-aware prompt fragments', () => {
    const fragments = compileCharacterBookPrompt({
      beforeCharacter: [{ entry: createEntry('before', { content: '前置设定。' }), sourceIndex: 0, reason: 'constant' }],
      afterCharacter: [{ entry: createEntry('after', { content: '后置设定。' }), sourceIndex: 1, reason: 'keyword' }],
      warnings: [],
    })

    expect(fragments.beforeCharacter).toContain('前置设定。')
    expect(fragments.afterCharacter).toContain('不能覆盖产品安全')
  })
})
