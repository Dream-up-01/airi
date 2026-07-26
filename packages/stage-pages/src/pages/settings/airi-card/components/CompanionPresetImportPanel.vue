<script setup lang="ts">
import type { CompanionPresetImportErrorCode } from '@proj-airi/stage-ui/composables/companionPresetFileReader'

import { CompanionPresetImportError, useCompanionPresetFileReader } from '@proj-airi/stage-ui/composables/companionPresetFileReader'
import { useCompanionPresetStore } from '@proj-airi/stage-ui/stores/companion'
import { Button, Callout } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import CompanionPresetPreview from './CompanionPresetPreview.vue'

const { t } = useI18n()
const fileReader = useCompanionPresetFileReader()
const presetStore = useCompanionPresetStore()
const {
  bindingWarnings,
  canActivate,
  canRestore,
  isPreviewActive,
  preview,
  replacementConfirmed,
  validationErrors,
  willReplaceExistingCard,
} = storeToRefs(presetStore)

const loading = shallowRef(false)
const importErrorCode = shallowRef<CompanionPresetImportErrorCode>()

const modelBindingSummary = computed(() => {
  const bindings = preview.value?.preset.model_bindings
  const configured = [
    bindings?.consciousness?.model,
    bindings?.vision?.model,
    bindings?.speech?.voice_id,
    bindings?.display_model_id,
  ].filter(Boolean)

  return configured.length > 0
    ? configured.join(' · ')
    : t('settings.pages.card.companion_import.current_models')
})

async function selectPreset() {
  if (!fileReader || loading.value)
    return

  loading.value = true
  importErrorCode.value = undefined
  try {
    const selected = await fileReader.pickAndParse()
    if (!selected)
      return

    presetStore.previewParsedPreset(selected.value, selected.sourceName)
  }
  catch (error) {
    importErrorCode.value = error instanceof CompanionPresetImportError ? error.code : 'unknown'
    presetStore.clearPreview()
  }
  finally {
    loading.value = false
  }
}

function activatePreset() {
  presetStore.activatePreview()
}

function restorePrevious() {
  presetStore.restorePrevious()
}
</script>

<template>
  <section
    v-if="fileReader"
    :class="[
      'rounded-xl p-4',
      'flex flex-col gap-4',
      'border border-primary-200/60 dark:border-primary-700/40',
      'bg-primary-50/40 dark:bg-primary-950/15',
    ]"
  >
    <div :class="['flex flex-wrap items-start justify-between gap-3']">
      <div :class="['min-w-0 flex-1']">
        <h2 :class="['text-base font-semibold text-neutral-800 dark:text-neutral-100']">
          {{ t('settings.pages.card.companion_import.title') }}
        </h2>
        <p :class="['mt-1 text-sm text-neutral-600 dark:text-neutral-400']">
          {{ t('settings.pages.card.companion_import.description') }}
        </p>
      </div>
      <div :class="['flex flex-wrap gap-2']">
        <Button
          v-if="canRestore"
          icon="i-solar:restart-line-duotone"
          :label="t('settings.pages.card.companion_import.restore')"
          variant="secondary"
          @click="restorePrevious"
        />
        <Button
          icon="i-solar:upload-square-line-duotone"
          :label="t('settings.pages.card.companion_import.select')"
          :loading="loading"
          variant="secondary"
          @click="selectPreset"
        />
      </div>
    </div>

    <Callout
      v-if="importErrorCode"
      theme="orange"
      :label="t('settings.pages.card.companion_import.read_error')"
    >
      {{ t(`settings.pages.card.companion_import.import_errors.${importErrorCode}`) }}
    </Callout>

    <Callout
      v-if="validationErrors.length > 0"
      theme="orange"
      :label="t('settings.pages.card.companion_import.validation_error')"
    >
      <ul :class="['list-disc space-y-2 pl-5 text-sm']">
        <li v-for="error in validationErrors" :key="`${error.path}:${error.code}:${error.message}`">
          <div><code>{{ error.path }}</code>: {{ t(`settings.pages.card.companion_import.validation_errors.${error.code}`, { path: error.path }) }}</div>
          <div :class="['text-xs text-neutral-600 dark:text-neutral-400']">
            {{ t(`settings.pages.card.companion_import.validation_suggestions.${error.suggestion}`) }}
          </div>
        </li>
      </ul>
    </Callout>

    <CompanionPresetPreview
      v-if="preview"
      :binding-warnings="bindingWarnings"
      :can-activate="canActivate"
      :model-binding-summary="modelBindingSummary"
      :preview="preview"
      :replacement-confirmed="replacementConfirmed"
      :will-replace-existing-card="willReplaceExistingCard"
      @activate="activatePreset"
      @confirm-replacement="presetStore.confirmReplacement()"
    />

    <Callout v-if="isPreviewActive" theme="lime" :label="t('settings.pages.card.companion_import.activated')" />
  </section>
</template>
