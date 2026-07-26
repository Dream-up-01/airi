import type { CharacterCandidate, CharacterDraft, CharacterExtractionJob, CharacterFact, CharacterSourceDocument } from '../domains/characterSource/contracts'
import type { CharacterExtractorErrorCode, ExtractorProviderConfig, StructuredCharacterExtractor } from '../services/characterExtractor'

import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { verifyCharacterSourceAnalysis } from '../domains/characterSource/evidence'
import { buildDraftFromReducerResult, reduceAnalysis } from '../domains/characterSource/reducer'
import {
  CHARACTER_EXTRACTOR_PROMPT_VERSION,
  CHARACTER_EXTRACTOR_SCHEMA_VERSION,
  CharacterExtractorError,
  xsaiStructuredCharacterExtractor,
} from '../services/characterExtractor'

const blocksPerBatch = 8
const concurrentBatches = 2
const maxRetries = 2
const characterExtractorErrorCodes = new Set<CharacterExtractorErrorCode>([
  'aborted',
  'candidate_extraction_failed',
  'fact_extraction_failed',
  'provider_incompatible',
  'validation_failed',
  'unknown',
])

type ExtractionState = CharacterExtractionJob['state']

const legalTransitions: Record<ExtractionState, readonly ExtractionState[]> = {
  'reading': ['segmenting', 'failed', 'cancelled'],
  'segmenting': ['discovering-candidates', 'failed', 'cancelled'],
  'discovering-candidates': ['awaiting-character-selection', 'extracting', 'failed', 'cancelled'],
  'awaiting-character-selection': ['extracting', 'failed', 'cancelled'],
  'extracting': ['merging', 'failed', 'cancelled'],
  'merging': ['reviewing', 'failed', 'cancelled'],
  'reviewing': ['completed', 'failed', 'cancelled'],
  'completed': [],
  'failed': [],
  'cancelled': [],
}

/** Validates the public extraction lifecycle independently of Pinia. */
export function isCharacterExtractionTransitionAllowed(from: ExtractionState, to: ExtractionState): boolean {
  return from === to || legalTransitions[from].includes(to)
}

function normalizeCharacterExtractorError(error: unknown): CharacterExtractorError | undefined {
  if (error instanceof CharacterExtractorError)
    return error
  if (!error || typeof error !== 'object' || Reflect.get(error, 'name') !== 'CharacterExtractorError')
    return undefined
  const code = Reflect.get(error, 'code')
  if (typeof code !== 'string' || !characterExtractorErrorCodes.has(code as CharacterExtractorErrorCode))
    return undefined
  return new CharacterExtractorError(code as CharacterExtractorErrorCode, Reflect.get(error, 'retryable') === true)
}

function fallbackErrorCode(state: ExtractionState | undefined): CharacterExtractorErrorCode {
  if (state === 'discovering-candidates')
    return 'candidate_extraction_failed'
  if (state === 'extracting')
    return 'fact_extraction_failed'
  if (state === 'merging' || state === 'reviewing')
    return 'validation_failed'
  return 'unknown'
}

/** Owns one cancellable extraction job without persisting source document text. */
export const useCharacterExtractionStore = defineStore('character-extraction', () => {
  const job = ref<CharacterExtractionJob | null>(null)
  const activeDocument = shallowRef<CharacterSourceDocument | null>(null)
  const activeProviderDocument = shallowRef<CharacterSourceDocument | null>(null)
  const candidates = ref<CharacterCandidate[]>([])
  const completedDraft = ref<CharacterDraft | null>(null)
  let currentController: AbortController | null = null

  const candidateEvidence = computed<Record<string, Array<{ blockId: string, text: string }>>>(() => {
    const document = activeDocument.value
    if (!document)
      return {}
    const blocksById = new Map(document.blocks.map(block => [block.blockId, block.text]))
    return Object.fromEntries(candidates.value.map(candidate => [
      candidate.candidateId,
      candidate.evidenceBlockIds.slice(0, 8).flatMap((blockId) => {
        const text = blocksById.get(blockId)
        return text ? [{ blockId, text: text.slice(0, 2_000) }] : []
      }),
    ]))
  })

  function isCurrent(jobId: string): boolean {
    return job.value?.jobId === jobId
  }

  function updateJob(jobId: string, update: Partial<CharacterExtractionJob>): void {
    if (!job.value || !isCurrent(jobId))
      return
    if (update.state && !isCharacterExtractionTransitionAllowed(job.value.state, update.state))
      throw new Error(`Invalid character extraction transition: ${job.value.state} -> ${update.state}`)
    job.value = {
      ...job.value,
      ...update,
      metadata: { ...job.value.metadata, updatedAt: Date.now() },
    } as CharacterExtractionJob
  }

  function cleanupRuntime(jobId: string): void {
    if (!isCurrent(jobId))
      return
    activeDocument.value = null
    activeProviderDocument.value = null
    currentController = null
  }

  function fail(jobId: string, errorCode: string, retryable: boolean): void {
    if (!job.value || !isCurrent(jobId))
      return
    if (!isCharacterExtractionTransitionAllowed(job.value.state, 'failed'))
      return
    job.value = {
      schemaVersion: 1,
      jobId,
      documentId: job.value.documentId,
      completedUnits: job.value.completedUnits,
      totalUnits: job.value.totalUnits,
      metadata: { ...job.value.metadata, updatedAt: Date.now() },
      state: 'failed',
      errorCode,
      retryable,
    }
    cleanupRuntime(jobId)
  }

  function cancel(): void {
    const current = job.value
    currentController?.abort('user-cancelled')
    currentController = null
    activeDocument.value = null
    activeProviderDocument.value = null
    completedDraft.value = null
    candidates.value = []
    if (!current)
      return
    if (!isCharacterExtractionTransitionAllowed(current.state, 'cancelled'))
      return
    job.value = {
      schemaVersion: 1,
      jobId: current.jobId,
      documentId: current.documentId,
      completedUnits: current.completedUnits,
      totalUnits: current.totalUnits,
      metadata: { ...current.metadata, updatedAt: Date.now() },
      state: 'cancelled',
    }
  }

  function reset(): void {
    currentController?.abort('job-reset')
    currentController = null
    activeDocument.value = null
    activeProviderDocument.value = null
    completedDraft.value = null
    candidates.value = []
    job.value = null
  }

  async function retry<T>(jobId: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    let attempt = 0
    while (true) {
      try {
        return await operation()
      }
      catch (error) {
        if (signal.aborted || !isCurrent(jobId))
          throw new CharacterExtractorError('aborted')
        const extractorError = normalizeCharacterExtractorError(error)
        if (!extractorError || !extractorError.retryable || attempt >= maxRetries)
          throw error
        attempt++
        if (job.value && isCurrent(jobId)) {
          job.value = {
            ...job.value,
            metadata: {
              ...job.value.metadata,
              retryCount: job.value.metadata.retryCount + 1,
              updatedAt: Date.now(),
            },
          }
        }
        await new Promise<void>((resolve, reject) => {
          let timeout: ReturnType<typeof setTimeout>
          const onAbort = () => {
            clearTimeout(timeout)
            reject(new CharacterExtractorError('aborted'))
          }
          timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }, 250 * (2 ** (attempt - 1)))
          signal.addEventListener('abort', onAbort, { once: true })
        })
      }
    }
  }

  async function startExtraction(
    document: CharacterSourceDocument,
    provider: ExtractorProviderConfig,
    extractor: StructuredCharacterExtractor = xsaiStructuredCharacterExtractor,
    providerDocument: CharacterSourceDocument = document,
  ): Promise<void> {
    cancel()
    const jobId = `job:${nanoid()}`
    const startedAt = Date.now()
    const controller = new AbortController()
    currentController = controller
    activeDocument.value = document
    activeProviderDocument.value = providerDocument
    completedDraft.value = null
    candidates.value = []
    job.value = {
      schemaVersion: 1,
      jobId,
      documentId: document.documentId,
      state: 'reading',
      completedUnits: 0,
      totalUnits: document.blocks.length,
      metadata: {
        providerId: provider.providerId,
        modelId: provider.model,
        extractorSchemaVersion: CHARACTER_EXTRACTOR_SCHEMA_VERSION,
        extractorPromptVersion: CHARACTER_EXTRACTOR_PROMPT_VERSION,
        segmenterVersion: '1',
        retryCount: 0,
        startedAt,
        updatedAt: startedAt,
        parameters: { blocksPerBatch, concurrentBatches, maxRetries },
      },
    }

    try {
      updateJob(jobId, { state: 'segmenting' })
      updateJob(jobId, { state: 'discovering-candidates' })
      const discovered = await retry(jobId, controller.signal, () =>
        extractor.discoverCandidates(providerDocument, provider, controller.signal))
      if (!isCurrent(jobId) || controller.signal.aborted)
        return
      candidates.value = discovered

      if (discovered.length === 1 && discovered[0]!.ambiguity === 'clear') {
        await runExtraction(document, providerDocument, discovered[0]!, provider, extractor, controller.signal, jobId)
        return
      }
      if (discovered.length > 0) {
        if (!isCharacterExtractionTransitionAllowed(job.value!.state, 'awaiting-character-selection'))
          throw new Error('Invalid character extraction candidate-selection transition.')
        job.value = {
          ...job.value!,
          state: 'awaiting-character-selection',
          candidateIds: discovered.map(candidate => candidate.candidateId),
          metadata: { ...job.value!.metadata, updatedAt: Date.now() },
        }
        currentController = null
        return
      }
      fail(jobId, 'no_candidates_found', false)
    }
    catch (error) {
      if (!isCurrent(jobId))
        return
      const extractorError = normalizeCharacterExtractorError(error)
      if (controller.signal.aborted || extractorError?.code === 'aborted') {
        cancel()
        return
      }
      fail(jobId, extractorError?.code ?? fallbackErrorCode(job.value?.state), extractorError?.retryable ?? false)
    }
  }

  async function resumeWithCandidate(
    candidateId: string,
    provider: ExtractorProviderConfig,
    extractor: StructuredCharacterExtractor = xsaiStructuredCharacterExtractor,
  ): Promise<void> {
    if (job.value?.state !== 'awaiting-character-selection' || !activeDocument.value || !activeProviderDocument.value)
      return
    const candidate = candidates.value.find(value => value.candidateId === candidateId)
    if (!candidate) {
      fail(job.value.jobId, 'invalid_candidate_selection', false)
      return
    }
    const jobId = job.value.jobId
    const controller = new AbortController()
    currentController = controller
    try {
      await runExtraction(activeDocument.value, activeProviderDocument.value, candidate, provider, extractor, controller.signal, jobId)
    }
    catch (error) {
      if (!isCurrent(jobId))
        return
      const extractorError = normalizeCharacterExtractorError(error)
      if (controller.signal.aborted || extractorError?.code === 'aborted') {
        cancel()
        return
      }
      fail(jobId, extractorError?.code ?? fallbackErrorCode(job.value?.state), extractorError?.retryable ?? false)
    }
  }

  async function runExtraction(
    document: CharacterSourceDocument,
    providerDocument: CharacterSourceDocument,
    candidate: CharacterCandidate,
    provider: ExtractorProviderConfig,
    extractor: StructuredCharacterExtractor,
    signal: AbortSignal,
    jobId: string,
  ): Promise<void> {
    updateJob(jobId, { state: 'extracting', completedUnits: 0 })
    const batches: string[][] = []
    for (let index = 0; index < document.blocks.length; index += blocksPerBatch)
      batches.push(document.blocks.slice(index, index + blocksPerBatch).map(block => block.blockId))

    const facts: CharacterFact[] = []
    for (let index = 0; index < batches.length; index += concurrentBatches) {
      if (signal.aborted || !isCurrent(jobId))
        throw new CharacterExtractorError('aborted')
      const currentBatches = batches.slice(index, index + concurrentBatches)
      const results = await Promise.all(currentBatches.map(blockIds => retry(jobId, signal, () =>
        extractor.extractFacts(providerDocument, blockIds, candidate, provider, signal))))
      results.forEach(result => facts.push(...result))
      updateJob(jobId, { completedUnits: Math.min(document.blocks.length, (index + currentBatches.length) * blocksPerBatch) })
    }

    updateJob(jobId, { state: 'merging' })
    const analysis = verifyCharacterSourceAnalysis({
      schemaVersion: 1,
      documentId: document.documentId,
      candidates: candidates.value,
      selectedCandidateId: candidate.candidateId,
      facts,
      conflicts: [],
      unclassifiedBlockIds: document.blocks.map(block => block.blockId),
    }, document).analysis
    const reduced = reduceAnalysis(analysis)
    const unclassifiedBlockIds = new Set(reduced.unclassifiedBlockIds.slice(0, 256))
    const unclassifiedExcerpts = document.blocks
      .filter(block => unclassifiedBlockIds.has(block.blockId))
      .map(block => ({ blockId: block.blockId, text: block.text.slice(0, 2_000) }))
    const draft = buildDraftFromReducerResult(
      reduced,
      document.documentId,
      candidate.candidateId,
      candidate.name,
      candidate.evidenceBlockIds,
      unclassifiedExcerpts,
    )
    updateJob(jobId, { state: 'reviewing', completedUnits: document.blocks.length })
    completedDraft.value = draft
    if (!isCharacterExtractionTransitionAllowed(job.value!.state, 'completed'))
      throw new Error('Invalid character extraction completion transition.')
    job.value = {
      ...job.value!,
      state: 'completed',
      draftId: draft.draftId,
      completedUnits: document.blocks.length,
      metadata: { ...job.value!.metadata, updatedAt: Date.now() },
    }
    cleanupRuntime(jobId)
  }

  return { job, candidates, candidateEvidence, completedDraft, cancel, reset, startExtraction, resumeWithCandidate }
})
