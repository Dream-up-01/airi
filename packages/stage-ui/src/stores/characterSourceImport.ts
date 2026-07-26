import type { ChatProvider } from '@xsai-ext/providers/utils'

import type {
  CharacterConflict,
  CharacterDraft,
  CharacterDraftLoreEntry,
  CharacterSourceDocument,
  GroundedCharacterValue,
} from '../domains/characterSource/contracts'
import type { ExtractorProviderConfig } from '../services/characterExtractor'

import { defineStore } from 'pinia'
import { safeParse } from 'valibot'
import { computed, ref, toRaw } from 'vue'

import { compileDraftToCard } from '../domains/characterSource/compiler'
import { CharacterDraftSchema } from '../domains/characterSource/contracts'
import { redactCharacterSourceForProvider } from '../domains/characterSource/privacy'
import { useCharacterExtractionStore } from './characterExtraction'
import { useAiriCardStore } from './modules/airi-card'
import { useProvidersStore } from './providers'

export type ImportFlowStep = 'confirming' | 'done' | 'error' | 'extracting' | 'idle' | 'picking' | 'reviewing'
export type ConfirmableDraftField = 'description' | 'greetings' | 'messageExamples' | 'name' | 'nickname' | 'personality' | 'relationships' | 'scenario' | 'story'

/** Orchestrates preview, review, and exactly-once non-activating Card creation. */
export const useCharacterSourceImportStore = defineStore('character-source-import', () => {
  const extractionStore = useCharacterExtractionStore()

  const step = ref<ImportFlowStep>('idle')
  const errorCode = ref<string | null>(null)
  const selectedProvider = ref<{ providerId: string, model: string } | null>(null)
  const cloudConfirmed = ref(false)
  const editableDraft = ref<CharacterDraft | null>(null)
  const createdCardId = ref<string | null>(null)
  let providerRequest: ExtractorProviderConfig | null = null

  const hasBlockingConflicts = computed(() =>
    editableDraft.value?.conflicts.some(conflict => conflict.status === 'unresolved') ?? false,
  )
  const hasBlockingDraftIssues = computed(() => hasBlockingConflicts.value || !editableDraft.value?.name?.value.trim())

  function reset(): void {
    extractionStore.reset()
    step.value = 'idle'
    errorCode.value = null
    selectedProvider.value = null
    cloudConfirmed.value = false
    editableDraft.value = null
    createdCardId.value = null
    providerRequest = null
  }

  function setError(code: string): void {
    extractionStore.cancel()
    step.value = 'error'
    errorCode.value = code
    providerRequest = null
  }

  function adoptCompletedDraft(): boolean {
    if (extractionStore.job?.state !== 'completed' || !extractionStore.completedDraft)
      return false
    editableDraft.value = structuredClone(toRaw(extractionStore.completedDraft))
    step.value = 'reviewing'
    return true
  }

  function adoptExtractionFailure(): boolean {
    const job = extractionStore.job
    if (job?.state !== 'failed')
      return false
    setError(job.errorCode)
    return true
  }

  function open(): void {
    reset()
    step.value = 'picking'
  }

  async function startFromDocument(params: {
    document: CharacterSourceDocument
    providerId: string
    model: string
    cloudConfirmed: boolean
  }): Promise<void> {
    if (!params.cloudConfirmed) {
      setError('cloud_confirmation_required')
      return
    }
    step.value = 'extracting'
    selectedProvider.value = { providerId: params.providerId, model: params.model }
    cloudConfirmed.value = true
    try {
      const providersStore = useProvidersStore()
      const provider = await providersStore.getProviderInstance<ChatProvider>(params.providerId)
      providerRequest = { ...provider.chat(params.model), providerId: params.providerId }
      const providerDocument = redactCharacterSourceForProvider(params.document).document
      await extractionStore.startExtraction(params.document, providerRequest, undefined, providerDocument)
      if (adoptCompletedDraft())
        return
      adoptExtractionFailure()
    }
    catch {
      setError('provider_initialization_failed')
    }
  }

  async function selectCandidate(candidateId: string): Promise<void> {
    if (!providerRequest || extractionStore.job?.state !== 'awaiting-character-selection')
      return
    await extractionStore.resumeWithCandidate(candidateId, providerRequest)
    if (adoptCompletedDraft())
      return
    adoptExtractionFailure()
  }

  function updateDraftField<K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]): void {
    if (editableDraft.value)
      editableDraft.value = { ...editableDraft.value, [key]: value }
  }

  function resolveConflict(conflictId: string, decision: {
    status: CharacterConflict['status']
    selectedFactIds?: string[]
  }): boolean {
    const draft = editableDraft.value
    const conflict = draft?.conflicts.find(value => value.conflictId === conflictId)
    if (!draft || !conflict || decision.status === 'unresolved')
      return false
    const selected = decision.selectedFactIds ?? []
    const valid = decision.status === 'keep-one'
      ? selected.length === 1 && conflict.factIds.includes(selected[0]!)
      : decision.status === 'keep-both'
        ? selected.every(factId => conflict.factIds.includes(factId))
        : selected.length === 0
    if (!valid)
      return false
    editableDraft.value = {
      ...draft,
      conflicts: draft.conflicts.map(value => value.conflictId === conflictId
        ? {
            ...value,
            status: decision.status,
            selectedFactIds: decision.status === 'keep-both' ? [...value.factIds] : selected,
          }
        : value),
      blockingReasonCodes: draft.blockingReasonCodes.filter(code => code !== 'unresolved-conflicts'),
    }
    if (editableDraft.value.conflicts.some(value => value.status === 'unresolved'))
      editableDraft.value.blockingReasonCodes.push('unresolved-conflicts')
    return true
  }

  function confirmDraftValue(field: ConfirmableDraftField, index: number | null): void {
    const draft = editableDraft.value
    if (!draft)
      return
    if (field === 'name' || field === 'nickname' || field === 'description' || field === 'scenario') {
      const value = draft[field]
      if (index === null && value) {
        updateDraftField(field, { ...value, userConfirmed: true })
        confirmFacts(value.sourceFactIds ?? [])
      }
      return
    }
    const values: GroundedCharacterValue<string>[] = draft[field]
    if (index === null || !values[index])
      return
    const selectedValue = values[index]
    updateDraftField(field, values.map((value, valueIndex) => valueIndex === index ? { ...value, userConfirmed: true } : value))
    confirmFacts(selectedValue.sourceFactIds ?? [])
  }

  function confirmFacts(factIds: readonly string[]): void {
    const draft = editableDraft.value
    if (!draft)
      return
    const inferredFactIds = new Set(draft.facts
      .filter(fact => fact.supportStatus === 'inferred' && fact.evidenceValidation === 'verified')
      .map(fact => fact.factId))
    const confirmed = new Set(draft.confirmedFactIds)
    for (const factId of factIds) {
      if (inferredFactIds.has(factId))
        confirmed.add(factId)
    }
    updateDraftField('confirmedFactIds', [...confirmed])
  }

  function upsertLoreEntry(entry: CharacterDraftLoreEntry): void {
    const draft = editableDraft.value
    if (!draft)
      return
    const exists = draft.loreEntries.some(value => value.draftEntryId === entry.draftEntryId)
    updateDraftField('loreEntries', exists
      ? draft.loreEntries.map(value => value.draftEntryId === entry.draftEntryId ? entry : value)
      : [...draft.loreEntries, entry])
  }

  function replaceLoreEntries(entries: CharacterDraftLoreEntry[]): void {
    updateDraftField('loreEntries', entries)
  }

  function removeLoreEntry(draftEntryId: string): void {
    const draft = editableDraft.value
    if (draft)
      updateDraftField('loreEntries', draft.loreEntries.filter(entry => entry.draftEntryId !== draftEntryId))
  }

  function proceedToConfirm(): void {
    if (step.value === 'reviewing' && !hasBlockingDraftIssues.value)
      step.value = 'confirming'
  }

  function backToReview(): void {
    if (step.value === 'confirming')
      step.value = 'reviewing'
  }

  function confirmAndCreateCard(): string | null {
    if (step.value === 'done')
      return createdCardId.value
    if (step.value !== 'confirming' || !editableDraft.value || hasBlockingDraftIssues.value)
      return null
    const validation = safeParse(CharacterDraftSchema, editableDraft.value)
    if (!validation.success) {
      setError('draft_validation_failed')
      return null
    }
    try {
      const cardId = useAiriCardStore().addCard(compileDraftToCard(validation.output))
      createdCardId.value = cardId
      editableDraft.value = null
      providerRequest = null
      extractionStore.reset()
      step.value = 'done'
      return cardId
    }
    catch {
      setError('card_creation_failed')
      return null
    }
  }

  function cancelImport(): void {
    reset()
  }

  return {
    step,
    errorCode,
    selectedProvider,
    cloudConfirmed,
    editableDraft,
    createdCardId,
    hasBlockingConflicts,
    hasBlockingDraftIssues,
    extractionJob: computed(() => extractionStore.job),
    extractionCandidates: computed(() => extractionStore.candidates),
    extractionCandidateEvidence: computed(() => extractionStore.candidateEvidence),
    open,
    startFromDocument,
    selectCandidate,
    updateDraftField,
    resolveConflict,
    confirmDraftValue,
    confirmFacts,
    upsertLoreEntry,
    replaceLoreEntries,
    removeLoreEntry,
    proceedToConfirm,
    backToReview,
    confirmAndCreateCard,
    cancelImport,
  }
})
