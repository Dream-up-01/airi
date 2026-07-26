import type { CompanionPresetValidationError, NormalizedCompanionPreset, PromptSection } from '../domains/companion'

import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import { compileCompanionPrompt, validateCompanionPreset } from '../domains/companion'
import { prepareCompanionCard } from '../services/companion'
import { useDisplayModelsStore } from './display-models'
import { useAiriCardStore } from './modules/airi-card'
import { useProvidersStore } from './providers'

/**
 * Read-only preview produced before a companion preset can change active state.
 */
export interface CompanionPresetPreview {
  /** Sanitized file label shown to the user; never an absolute path. */
  sourceName: string
  /** Validated and normalized preset. */
  preset: NormalizedCompanionPreset
  /** Stable prompt sections available to development diagnostics. */
  promptSections: PromptSection[]
}

/**
 * Coordinates validated companion previews, conflict confirmation, activation, and rollback.
 *
 * Use when:
 * - Shared Stage settings need to manage the companion preset lifecycle.
 *
 * Expects:
 * - Platform code parses files before calling `previewParsedPreset`.
 * - AIRI Card, provider, and display-model stores are available in the active Pinia.
 *
 * Returns:
 * - Readable lifecycle state and explicit actions; previewing never mutates the active card.
 */
export const useCompanionPresetStore = defineStore('companion-preset', () => {
  const cardStore = useAiriCardStore()
  const displayModelsStore = useDisplayModelsStore()
  const providersStore = useProvidersStore()
  const preview = shallowRef<CompanionPresetPreview>()
  const validationErrors = shallowRef<CompanionPresetValidationError[]>([])
  const replacementConfirmed = shallowRef(false)

  const targetCardId = computed(() => preview.value ? `companion:${preview.value.preset.id}` : undefined)
  const isPreviewActive = computed(() => !!targetCardId.value && cardStore.activeCardId === targetCardId.value)
  const willReplaceExistingCard = computed(() => targetCardId.value ? cardStore.cards.has(targetCardId.value) : false)
  const previousActiveCardId = computed(() => {
    if (!targetCardId.value || cardStore.activeCardId !== targetCardId.value)
      return cardStore.activeCardId

    const previousId = cardStore.activeCard?.extensions.airi.companion?.activation?.previousActiveCardId
    return previousId && cardStore.cards.has(previousId) ? previousId : 'default'
  })
  const preparedPreview = computed(() => {
    if (!preview.value)
      return undefined

    const availableProviderIds = new Set(providersStore.availableProviders)
    const availableProviderIdsByBinding = {
      consciousness: new Set<string>(),
      speech: new Set<string>(),
      vision: new Set<string>(),
    }
    const knownModelsByProvider = new Map<string, ReadonlySet<string>>()
    for (const providerId of availableProviderIds) {
      const category = providersStore.getProviderMetadata(providerId).category
      if (category === 'chat')
        availableProviderIdsByBinding.consciousness.add(providerId)
      else if (category === 'speech')
        availableProviderIdsByBinding.speech.add(providerId)
      else if (category === 'vision')
        availableProviderIdsByBinding.vision.add(providerId)

      const models = providersStore.getModelsForProvider(providerId)
      if (models.length > 0)
        knownModelsByProvider.set(providerId, new Set(models.map(model => model.id)))
    }

    const availableDisplayModelIds = new Set(displayModelsStore.displayModels.map(model => model.id))
    if (cardStore.currentModels.displayModelId)
      availableDisplayModelIds.add(cardStore.currentModels.displayModelId)

    return prepareCompanionCard(preview.value.preset, {
      availableDisplayModelIds,
      availableProviderIdsByBinding,
      fallbackModules: cardStore.currentModels,
      knownModelsByProvider,
      previousActiveCardId: previousActiveCardId.value,
    })
  })
  const bindingWarnings = computed(() => preparedPreview.value?.bindingWarnings ?? [])
  const canActivate = computed(() => !!preparedPreview.value
    && validationErrors.value.length === 0
    && (!willReplaceExistingCard.value || replacementConfirmed.value))
  const restoreTargetCardId = computed(() => {
    const previousId = cardStore.activeCard?.extensions.airi.companion?.activation?.previousActiveCardId
    if (previousId && cardStore.cards.has(previousId))
      return previousId
    if (cardStore.activeCard?.extensions.airi.companion && cardStore.cards.has('default'))
      return 'default'
    return undefined
  })
  const canRestore = computed(() => {
    if (cardStore.activationSnapshot && cardStore.activeCardId === cardStore.activationSnapshot.cardId)
      return true

    return !!restoreTargetCardId.value
  })

  /**
   * Validates untrusted parsed data without changing active character state.
   *
   * Use when:
   * - A platform-specific YAML/JSON reader returns an unknown value.
   *
   * Expects:
   * - `sourceName` is a basename or user-facing label, not an absolute path.
   *
   * Returns:
   * - `true` when a preview is ready; otherwise validation errors are exposed.
   */
  function previewParsedPreset(input: unknown, sourceName: string): boolean {
    replacementConfirmed.value = false
    const result = validateCompanionPreset(input)
    if (!result.success) {
      preview.value = undefined
      validationErrors.value = result.errors
      return false
    }

    const compiledPrompt = compileCompanionPrompt(result.value)
    preview.value = {
      sourceName,
      preset: result.value,
      promptSections: compiledPrompt.sections,
    }
    validationErrors.value = []
    return true
  }

  /**
   * Atomically installs and activates the current validated preview.
   *
   * Use when:
   * - The user explicitly confirms an import preview.
   *
   * Expects:
   * - `previewParsedPreset` has succeeded and `canActivate` is true.
   *
   * Returns:
   * - The activated local AIRI Card ID, or `undefined` when no preview exists.
   */
  function activatePreview(): string | undefined {
    if (!canActivate.value || !preparedPreview.value)
      return undefined

    const prepared = preparedPreview.value
    cardStore.upsertAndActivateCard(prepared.cardId, prepared.card)
    replacementConfirmed.value = false
    return prepared.cardId
  }

  /** Confirms replacement only for the currently previewed duplicate card ID. */
  function confirmReplacement() {
    if (willReplaceExistingCard.value)
      replacementConfirmed.value = true
  }

  /**
   * Restores the exact activation snapshot or switches to the persisted origin card.
   *
   * Use when:
   * - A user requests rollback after preview activation.
   *
   * Expects:
   * - Exact replacement rollback is available for the latest persisted activation snapshot.
   * - Metadata-only recovery retains the imported card when the exact snapshot is unavailable.
   *
   * Returns:
   * - `true` when a snapshot was restored, otherwise `false`.
   */
  function restorePrevious(): boolean {
    if (cardStore.activationSnapshot && cardStore.restoreCardActivation(cardStore.activationSnapshot)) {
      // Replacing the currently active companion restores the previous
      // companion version first. The user-facing action is still "disable",
      // so continue to that restored card's persisted non-companion origin.
      const restoredOriginId = restoreTargetCardId.value
      if (restoredOriginId)
        cardStore.activateCard(restoredOriginId)
      return true
    }

    if (!restoreTargetCardId.value)
      return false

    const restored = cardStore.activateCard(restoreTargetCardId.value)
    if (restored)
      cardStore.clearCardActivationSnapshot()
    return restored
  }

  function clearPreview() {
    preview.value = undefined
    validationErrors.value = []
    replacementConfirmed.value = false
  }

  return {
    bindingWarnings,
    canActivate,
    canRestore,
    isPreviewActive,
    lastActivation: computed(() => cardStore.activationSnapshot),
    preview,
    replacementConfirmed,
    targetCardId,
    validationErrors,
    willReplaceExistingCard,
    activatePreview,
    clearPreview,
    confirmReplacement,
    previewParsedPreset,
    restorePrevious,
  }
})
