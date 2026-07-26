<script setup lang="ts">
import type { CharacterSourceDocument } from '@proj-airi/stage-ui/domains/characterSource'

import { useCharacterSourceDocumentSession } from '@proj-airi/stage-ui/composables/characterSourceFileReader'
import { redactCharacterSourceForProvider } from '@proj-airi/stage-ui/domains/characterSource'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  cancel: []
  start: [params: {
    document: CharacterSourceDocument
    providerId: string
    model: string
    cloudConfirmed: boolean
  }]
}>()

const { t } = useI18n()
const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const sourceSession = useCharacterSourceDocumentSession()
const { activeProvider, activeModel } = storeToRefs(consciousnessStore)

const selectedDocument = shallowRef<CharacterSourceDocument>()
const selectedProviderId = shallowRef(activeProvider.value ?? '')
const selectedModel = shallowRef(activeModel.value ?? '')
const cloudConfirmed = shallowRef(false)
const isPickingFile = shallowRef(false)
const pickError = shallowRef<string>()

const providerOptions = computed(() => providersStore.configuredChatProvidersMetadata.map(provider => ({
  id: provider.id,
  name: provider.localizedName || provider.name,
})))
const modelOptions = computed(() => selectedProviderId.value
  ? providersStore.getModelsForProvider(selectedProviderId.value)
  : [])
const redactionCount = computed(() => selectedDocument.value
  ? redactCharacterSourceForProvider(selectedDocument.value).redactions.length
  : 0)

watch(selectedProviderId, async (providerId, previousProviderId) => {
  if (!providerId)
    return
  if (providerId !== previousProviderId) {
    cloudConfirmed.value = false
    selectedModel.value = ''
    await consciousnessStore.loadModelsForProvider(providerId)
  }
  if (!selectedModel.value)
    selectedModel.value = modelOptions.value[0]?.id ?? ''
}, { immediate: true })

watch(selectedModel, (model, previousModel) => {
  if (model !== previousModel)
    cloudConfirmed.value = false
})

async function pickFile(): Promise<void> {
  cloudConfirmed.value = false
  isPickingFile.value = true
  pickError.value = undefined
  try {
    selectedDocument.value = await sourceSession.select()
  }
  catch (error) {
    pickError.value = error instanceof Error && 'code' in error
      ? t(`settings.pages.card.character_source_import.error_${String(error.code)}`)
      : t('settings.pages.card.character_source_import.pick_failed')
  }
  finally {
    isPickingFile.value = false
  }
}

function handleStart(): void {
  if (!selectedDocument.value || !selectedProviderId.value || !selectedModel.value || !cloudConfirmed.value)
    return
  emit('start', {
    document: selectedDocument.value,
    providerId: selectedProviderId.value,
    model: selectedModel.value,
    cloudConfirmed: true,
  })
}
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <h2 class="text-xl font-medium">
      {{ t('settings.pages.card.character_source_import.title') }}
    </h2>

    <div class="flex flex-col gap-2">
      <p class="text-sm text-neutral-600 font-medium dark:text-neutral-300">
        {{ t('settings.pages.card.character_source_import.file_label') }}
      </p>
      <p class="text-xs text-neutral-400 dark:text-neutral-500">
        {{ t('settings.pages.card.character_source_import.supported_formats') }}
      </p>
      <button
        class="flex items-center gap-2 border border-neutral-300 rounded-lg border-dashed bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-600 hover:border-primary-400 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:border-primary-600"
        :disabled="isPickingFile"
        @click="pickFile"
      >
        <span class="i-solar:file-add-line-duotone text-xl text-neutral-400" />
        <span v-if="selectedDocument">{{ selectedDocument.displayName }}</span>
        <span v-else>{{ t('settings.pages.card.character_source_import.pick_file') }}</span>
      </button>
      <p v-if="pickError" class="text-xs text-red-500">
        {{ pickError }}
      </p>
    </div>

    <div class="grid grid-cols-1 gap-3 rounded-lg bg-neutral-50 p-3 text-sm sm:grid-cols-2 dark:bg-neutral-800">
      <label class="flex flex-col gap-1">
        <span class="text-neutral-600 font-medium dark:text-neutral-300">{{ t('settings.pages.card.character_source_import.provider_label') }}</span>
        <select v-model="selectedProviderId" class="border border-neutral-200 rounded-lg bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
          <option value="" disabled>{{ t('settings.pages.card.character_source_import.no_provider') }}</option>
          <option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">
            {{ provider.name }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-neutral-600 font-medium dark:text-neutral-300">{{ t('settings.pages.card.character_source_import.model_label') }}</span>
        <select v-model="selectedModel" class="border border-neutral-200 rounded-lg bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
          <option value="" disabled>—</option>
          <option v-for="model in modelOptions" :key="model.id" :value="model.id">
            {{ model.name || model.id }}
          </option>
        </select>
      </label>
    </div>

    <label class="flex cursor-pointer items-start gap-3">
      <input v-model="cloudConfirmed" type="checkbox" class="mt-0.5 border-neutral-300 rounded">
      <span class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ t('settings.pages.card.character_source_import.cloud_confirm') }}
      </span>
    </label>
    <p v-if="selectedDocument" class="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {{ t('settings.pages.card.character_source_import.redaction_notice', { count: redactionCount }) }}
    </p>

    <div class="flex justify-end gap-3">
      <button class="rounded-lg px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300" @click="emit('cancel')">
        {{ t('settings.pages.card.cancel') }}
      </button>
      <button
        class="rounded-lg bg-primary-500 px-4 py-2 text-sm text-white font-medium disabled:cursor-not-allowed hover:bg-primary-600 disabled:opacity-40"
        :disabled="!selectedDocument || !cloudConfirmed || !selectedProviderId || !selectedModel"
        @click="handleStart"
      >
        {{ t('settings.pages.card.character_source_import.start') }}
      </button>
    </div>
  </div>
</template>
