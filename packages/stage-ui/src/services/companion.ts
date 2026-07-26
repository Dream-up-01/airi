import type { CompanionModelBindingKind, CompanionModelBindingWarning, CompiledCompanionPrompt, NormalizedCompanionPreset } from '../domains/companion'
import type { AiriCard, AiriExtension } from '../stores/modules/airi-card'

import { compileCompanionPrompt } from '../domains/companion'

/**
 * Prepared AIRI Card and diagnostics derived from a validated companion preset.
 */
export interface PreparedCompanionCard {
  /** Non-fatal model binding fallbacks that should be shown before activation. */
  bindingWarnings: CompanionModelBindingWarning[]
  /** Stable local card key reserved for companion presets. */
  cardId: string
  /** AIRI Card ready for atomic installation. */
  card: AiriCard
  /** Source-addressable prompt used by the card. */
  compiledPrompt: CompiledCompanionPrompt
}

/** Inputs used to resolve optional model bindings before card activation. */
export interface PrepareCompanionCardOptions {
  /** Display-model IDs currently available in the Stage model registry. @default undefined */
  availableDisplayModelIds?: ReadonlySet<string>
  /** Configured provider IDs grouped by the model capability they can serve. @default undefined */
  availableProviderIdsByBinding?: Partial<Record<Exclude<CompanionModelBindingKind, 'display'>, ReadonlySet<string>>>
  /** Current selections retained when a requested optional binding is unavailable. */
  fallbackModules: Pick<AiriExtension['modules'], 'consciousness' | 'vision' | 'speech' | 'displayModelId' | 'activeBackgroundId'>
  /** Loaded model inventories; absent provider entries mean the inventory is not known yet. @default undefined */
  knownModelsByProvider?: ReadonlyMap<string, ReadonlySet<string>>
  /** Card selected before companion activation, persisted for restart-safe deactivation. @default undefined */
  previousActiveCardId?: string
}

function resolveProviderBinding<T extends { model: string, provider: string }>(
  binding: Exclude<CompanionModelBindingKind, 'display'>,
  requested: T | undefined,
  fallback: T,
  options: PrepareCompanionCardOptions,
  warnings: CompanionModelBindingWarning[],
): T {
  if (!requested)
    return fallback

  const availableProviderIds = options.availableProviderIdsByBinding?.[binding]
  if (availableProviderIds && !availableProviderIds.has(requested.provider)) {
    warnings.push({
      binding,
      code: 'provider_unavailable',
      requested: `${requested.provider}/${requested.model}`,
    })
    return fallback
  }

  const knownModels = options.knownModelsByProvider?.get(requested.provider)
  if (knownModels && !knownModels.has(requested.model)) {
    warnings.push({
      binding,
      code: 'model_unavailable',
      requested: `${requested.provider}/${requested.model}`,
    })
    return fallback
  }

  return requested
}

/**
 * Builds an AIRI Card from a normalized companion preset.
 *
 * Use when:
 * - Import preview has passed schema validation and is ready for activation.
 * - Existing module selections should remain as fallbacks for missing bindings.
 *
 * Expects:
 * - `preset` is normalized and secret-free.
 * - `options.fallbackModules` reflects current user module selections.
 *
 * Returns:
 * - A deterministic companion card, stable card ID, and compiled prompt sections.
 */
export function prepareCompanionCard(
  preset: NormalizedCompanionPreset,
  options: PrepareCompanionCardOptions,
): PreparedCompanionCard {
  const compiledPrompt = compileCompanionPrompt(preset)
  const bindings = preset.model_bindings
  const cardId = `companion:${preset.id}`
  const bindingWarnings: CompanionModelBindingWarning[] = []
  const consciousness = resolveProviderBinding('consciousness', bindings.consciousness, options.fallbackModules.consciousness, options, bindingWarnings)
  const vision = resolveProviderBinding('vision', bindings.vision, options.fallbackModules.vision, options, bindingWarnings)
  const speech = resolveProviderBinding('speech', bindings.speech, options.fallbackModules.speech, options, bindingWarnings)
  let displayModelId = bindings.display_model_id ?? options.fallbackModules.displayModelId
  if (bindings.display_model_id && options.availableDisplayModelIds && !options.availableDisplayModelIds.has(bindings.display_model_id)) {
    bindingWarnings.push({
      binding: 'display',
      code: 'display_model_unavailable',
      requested: bindings.display_model_id,
    })
    displayModelId = options.fallbackModules.displayModelId
  }

  return {
    cardId,
    bindingWarnings,
    compiledPrompt,
    card: {
      name: preset.identity.name,
      version: preset.version,
      creator: 'AIRI CN Companion',
      description: preset.identity.description,
      personality: preset.behavior.personality.join('、'),
      scenario: preset.behavior.primary_scenarios.join('、'),
      greetings: [preset.behavior.greeting],
      systemPrompt: compiledPrompt.text,
      tags: ['cn-companion', preset.status, preset.identity.language],
      metadata: {
        companionPresetId: preset.id,
        companionSchemaVersion: preset.schema_version,
      },
      extensions: {
        airi: {
          modules: {
            consciousness,
            vision,
            speech,
            displayModelId,
            activeBackgroundId: options.fallbackModules.activeBackgroundId,
          },
          agents: {},
          companion: {
            activation: options.previousActiveCardId
              ? { previousActiveCardId: options.previousActiveCardId }
              : undefined,
            bindingWarnings,
            preset,
            promptSections: compiledPrompt.sections,
          },
        },
      },
    },
  }
}
