import { env } from 'node:process'

import { expect, it } from 'vitest'

import { preprocessCharacterSource } from '../domains/characterSource'
import { xsaiStructuredCharacterExtractor } from './characterExtractor'

const configured = Boolean(
  env.AIRI_CHARACTER_EXTRACTOR_BASE_URL
  && env.AIRI_CHARACTER_EXTRACTOR_MODEL
  && env.AIRI_CHARACTER_EXTRACTOR_API_KEY,
)

it.runIf(configured)('extracts a grounded candidate through the configured integration provider', async () => {
  const baseURL = env.AIRI_CHARACTER_EXTRACTOR_BASE_URL
  const model = env.AIRI_CHARACTER_EXTRACTOR_MODEL
  const apiKey = env.AIRI_CHARACTER_EXTRACTOR_API_KEY
  if (!baseURL || !model || !apiKey)
    throw new Error('Character extractor integration environment is incomplete.')

  const document = preprocessCharacterSource({
    displayName: 'integration-character.txt',
    contentHash: '0123456789abcdef'.repeat(4),
    text: '角色名：栖遥\n栖遥说话沉稳，会在不确定时承认自己不知道。',
  })
  const provider = {
    apiKey,
    baseURL,
    model,
    providerId: 'integration-provider',
  }
  const signal = new AbortController().signal
  const candidates = await xsaiStructuredCharacterExtractor.discoverCandidates(document, provider, signal)

  expect(candidates.length).toBeGreaterThan(0)
  expect(candidates.some(candidate => candidate.name.includes('栖遥'))).toBe(true)
  const selected = candidates.find(candidate => candidate.name.includes('栖遥'))!
  const facts = await xsaiStructuredCharacterExtractor.extractFacts(
    document,
    document.blocks.map(block => block.blockId),
    selected,
    provider,
    signal,
  )
  expect(facts.some(fact => fact.candidateId === selected.candidateId)).toBe(true)
})
