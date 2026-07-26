import type { CharacterCandidate, CharacterSourceDocument } from '../domains/characterSource'
import type { ExtractorProviderConfig, StructuredCharacterExtractor } from '../services/characterExtractor'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { preprocessCharacterSource, redactCharacterSourceForProvider } from '../domains/characterSource'
import { CharacterExtractorError } from '../services/characterExtractor'
import { isCharacterExtractionTransitionAllowed, useCharacterExtractionStore } from './characterExtraction'

const provider: ExtractorProviderConfig = {
  apiKey: 'not-a-real-key',
  baseURL: 'https://provider.invalid/v1/',
  model: 'test-model',
  providerId: 'test-provider',
}

function document(): CharacterSourceDocument {
  return preprocessCharacterSource({
    displayName: 'character.txt',
    contentHash: '0123456789abcdef'.repeat(4),
    text: '栖遥说：“先坐一会儿吧。”',
  })
}

function largeDocument(blockCount: number): CharacterSourceDocument {
  return preprocessCharacterSource({
    displayName: 'large-character.txt',
    contentHash: 'fedcba9876543210'.repeat(4),
    text: Array.from({ length: blockCount }, (_, index) => `- 栖遥设定 ${index + 1}`).join('\n'),
  })
}

function candidate(id = 'candidate:qiyao', ambiguity: CharacterCandidate['ambiguity'] = 'clear'): CharacterCandidate {
  return {
    candidateId: id,
    name: '栖遥',
    aliases: [],
    evidenceBlockIds: ['block-00001'],
    ambiguity,
  }
}

function extractor(candidates: CharacterCandidate[] = [candidate()]): StructuredCharacterExtractor {
  return {
    discoverCandidates: async () => candidates,
    extractFacts: async (_document, _blockIds, selectedCandidate) => [{
      factId: 'fact:qiyao:personality',
      candidateId: selectedCandidate.candidateId,
      category: 'personality',
      predicate: 'personality',
      value: '愿意先倾听',
      supportStatus: 'explicit',
      evidenceBlockIds: ['block-00001'],
      quote: '先坐一会儿吧。',
      evidenceValidation: 'unverified',
    }],
  }
}

describe('character extraction job lifecycle', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('allows only the declared forward, failure, and cancellation transitions', () => {
    expect(isCharacterExtractionTransitionAllowed('reading', 'segmenting')).toBe(true)
    expect(isCharacterExtractionTransitionAllowed('discovering-candidates', 'awaiting-character-selection')).toBe(true)
    expect(isCharacterExtractionTransitionAllowed('awaiting-character-selection', 'extracting')).toBe(true)
    expect(isCharacterExtractionTransitionAllowed('reviewing', 'completed')).toBe(true)
    expect(isCharacterExtractionTransitionAllowed('completed', 'extracting')).toBe(false)
    expect(isCharacterExtractionTransitionAllowed('failed', 'reading')).toBe(false)
  })

  it('completes a clear candidate without persisting source text or its hash in job metadata', async () => {
    const source = document()
    const store = useCharacterExtractionStore()

    await store.startExtraction(source, provider, extractor())

    expect(store.job?.state).toBe('completed')
    expect(store.completedDraft?.name?.value).toBe('栖遥')
    expect(store.completedDraft?.personality[0]?.evidenceValidation).toBe('verified')
    expect(JSON.stringify(store.job)).not.toContain(source.contentHash)
    expect(JSON.stringify(store.job)).not.toContain(source.blocks[0]!.text)
  })

  it('pauses for an ambiguous candidate and resumes only with an explicit selection', async () => {
    const choices = [
      candidate('candidate:qiyao', 'multiple-primary-candidates'),
      { ...candidate('candidate:lin'), name: '林渡' },
    ]
    const selectedExtractor = extractor(choices)
    const store = useCharacterExtractionStore()

    await store.startExtraction(document(), provider, selectedExtractor)

    expect(store.job?.state).toBe('awaiting-character-selection')
    expect(store.completedDraft).toBeNull()
    expect(store.candidateEvidence['candidate:qiyao']?.[0]?.text).toContain('栖遥')

    await store.resumeWithCandidate('candidate:qiyao', provider, selectedExtractor)

    expect(store.job?.state).toBe('completed')
    expect(store.completedDraft?.selectedCandidateId).toBe('candidate:qiyao')
    expect(store.candidateEvidence).toEqual({})
  })

  it('keeps local evidence original while sending only the redacted provider copy', async () => {
    const localDocument = preprocessCharacterSource({
      displayName: 'private-character.txt',
      contentHash: '0123456789abcdef'.repeat(4),
      text: '栖遥的令牌是 sk-abcdefghijklmnop。',
    })
    const providerDocument = redactCharacterSourceForProvider(localDocument).document
    let providerPayload = ''
    const selectedExtractor: StructuredCharacterExtractor = {
      discoverCandidates: async (source) => {
        providerPayload = source.blocks.map(block => block.text).join('\n')
        return [candidate('candidate:qiyao', 'multiple-primary-candidates')]
      },
      extractFacts: async () => [],
    }
    const store = useCharacterExtractionStore()

    await store.startExtraction(localDocument, provider, selectedExtractor, providerDocument)

    expect(providerPayload).toContain('[REDACTED:credential]')
    expect(providerPayload).not.toContain('sk-abcdefghijklmnop')
    expect(store.candidateEvidence['candidate:qiyao']?.[0]?.text).toContain('sk-abcdefghijklmnop')
    store.cancel()
    expect(store.candidateEvidence).toEqual({})
  })

  it('cancels in-flight discovery and prevents a late reducer write', async () => {
    const pendingExtractor: StructuredCharacterExtractor = {
      discoverCandidates: (_document, _provider, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new CharacterExtractorError('aborted')), { once: true })
      }),
      extractFacts: async () => [],
    }
    const store = useCharacterExtractionStore()
    const running = store.startExtraction(document(), provider, pendingExtractor)

    store.cancel()
    await running

    expect(store.job?.state).toBe('cancelled')
    expect(store.completedDraft).toBeNull()
  })

  it('retries bounded transient failures and exposes the retry count', async () => {
    let attempts = 0
    const retryingExtractor = extractor()
    retryingExtractor.discoverCandidates = async () => {
      attempts++
      if (attempts === 1)
        throw new CharacterExtractorError('candidate_extraction_failed', true)
      return [candidate()]
    }
    const store = useCharacterExtractionStore()

    await store.startExtraction(document(), provider, retryingExtractor)

    expect(attempts).toBe(2)
    expect(store.job?.metadata.retryCount).toBe(1)
    expect(store.job?.state).toBe('completed')
  })

  it('preserves extractor error codes across hot-reload or cross-realm class boundaries', async () => {
    let attempts = 0
    const retryingExtractor = extractor()
    retryingExtractor.discoverCandidates = async () => {
      attempts++
      if (attempts === 1) {
        throw Object.assign(new Error('synthetic cross-realm extractor failure'), {
          name: 'CharacterExtractorError',
          code: 'candidate_extraction_failed',
          retryable: true,
        })
      }
      return [candidate()]
    }
    const store = useCharacterExtractionStore()

    await store.startExtraction(document(), provider, retryingExtractor)

    expect(attempts).toBe(2)
    expect(store.job?.state).toBe('completed')
  })

  it('classifies an unexpected discovery exception by its active phase', async () => {
    const brokenExtractor = extractor()
    brokenExtractor.discoverCandidates = async () => {
      throw new TypeError('synthetic failure')
    }
    const store = useCharacterExtractionStore()

    await store.startExtraction(document(), provider, brokenExtractor)

    expect(store.job).toMatchObject({
      state: 'failed',
      errorCode: 'candidate_extraction_failed',
      retryable: false,
    })
  })

  it('does not downgrade provider incompatibility to free text or retry it', async () => {
    let attempts = 0
    const incompatible: StructuredCharacterExtractor = {
      discoverCandidates: async () => {
        attempts++
        throw new CharacterExtractorError('provider_incompatible')
      },
      extractFacts: async () => [],
    }
    const store = useCharacterExtractionStore()

    await store.startExtraction(document(), provider, incompatible)

    expect(attempts).toBe(1)
    expect(store.job).toMatchObject({ state: 'failed', errorCode: 'provider_incompatible', retryable: false })
  })

  it('uses smaller fact batches and limits extraction concurrency to two', async () => {
    let active = 0
    let maximumActive = 0
    const batchSizes: number[] = []
    const boundedExtractor: StructuredCharacterExtractor = {
      discoverCandidates: async () => [candidate()],
      extractFacts: async (_source, blockIds) => {
        batchSizes.push(blockIds.length)
        active++
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active--
        return []
      },
    }
    const store = useCharacterExtractionStore()

    await store.startExtraction(largeDocument(81), provider, boundedExtractor)

    expect(store.job?.state).toBe('completed')
    expect(maximumActive).toBe(2)
    expect(Math.max(...batchSizes)).toBe(8)
  })

  it('fails closed without compiling a partial draft when one fact batch fails', async () => {
    const partialFailureExtractor: StructuredCharacterExtractor = {
      discoverCandidates: async () => [candidate()],
      extractFacts: async (_source, blockIds) => {
        if (blockIds.includes('block-00021'))
          throw new CharacterExtractorError('fact_extraction_failed')
        return []
      },
    }
    const store = useCharacterExtractionStore()

    await store.startExtraction(largeDocument(41), provider, partialFailureExtractor)

    expect(store.job).toMatchObject({ state: 'failed', errorCode: 'fact_extraction_failed' })
    expect(store.completedDraft).toBeNull()
  })
})
