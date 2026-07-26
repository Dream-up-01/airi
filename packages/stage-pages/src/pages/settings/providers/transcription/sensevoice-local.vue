<script setup lang="ts">
import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import {
  Alert,
  ProviderAdvancedSettings,
  ProviderBaseUrlInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  TranscriptionPlayground,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { notifyVoiceSettingsChanged, voiceSettingsStorageKeys } from '@proj-airi/stage-ui/services/voice-settings-sync'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import {
  QWEN3_ASR_LOCAL_PROVIDER_ID,
  SENSEVOICE_LOCAL_DEFAULT_BASE_URL,
  SENSEVOICE_LOCAL_DEFAULT_LANGUAGE,
  SENSEVOICE_LOCAL_DEFAULT_MODEL,
  SENSEVOICE_LOCAL_PROVIDER_ID,
  useProvidersStore,
} from '@proj-airi/stage-ui/stores/providers'
import { Button, FieldCombobox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, shallowRef } from 'vue'

import { startLocalVoiceService, stopLocalVoiceService } from '../../../../composables/use-local-voice-service-start'

const providerId = SENSEVOICE_LOCAL_PROVIDER_ID
const hearingStore = useHearingStore()
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore)
const activationError = shallowRef('')
const isStarting = shallowRef(false)

const {
  t,
  router,
  providerMetadata,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  validateConfiguration,
} = useProviderValidation(providerId)

const baseUrl = computed({
  get: () => (providers.value[providerId]?.baseUrl as string | undefined) || SENSEVOICE_LOCAL_DEFAULT_BASE_URL,
  set: (value: string) => {
    providers.value[providerId] = {
      ...providers.value[providerId],
      baseUrl: value,
    }
  },
})

const model = computed({
  get: () => (providers.value[providerId]?.model as string | undefined) || SENSEVOICE_LOCAL_DEFAULT_MODEL,
  set: (value: string) => {
    providers.value[providerId] = {
      ...providers.value[providerId],
      model: value,
    }
  },
})

const language = computed({
  get: () => (providers.value[providerId]?.language as string | undefined) || SENSEVOICE_LOCAL_DEFAULT_LANGUAGE,
  set: (value: string) => {
    providers.value[providerId] = {
      ...providers.value[providerId],
      language: value,
    }
  },
})

const languageOptions = computed(() => [
  { label: t('settings.pages.providers.provider.sensevoice-local.settings.language_zh'), value: 'zh' },
  { label: t('settings.pages.providers.provider.sensevoice-local.settings.language_auto'), value: 'auto' },
  { label: t('settings.pages.providers.provider.sensevoice-local.settings.language_en'), value: 'en' },
  { label: t('settings.pages.providers.provider.sensevoice-local.settings.language_ja'), value: 'ja' },
  { label: t('settings.pages.providers.provider.sensevoice-local.settings.language_ko'), value: 'ko' },
])

const modelOptions = computed(() => [{
  label: t('settings.pages.providers.provider.sensevoice-local.settings.model_sensevoice_small'),
  value: SENSEVOICE_LOCAL_DEFAULT_MODEL,
}])

async function generateTranscription(file: File) {
  const provider = await providersStore.getProviderInstance<TranscriptionProviderWithExtraOptions<string, Record<string, unknown>>>(providerId)
  return await hearingStore.transcription(
    providerId,
    provider,
    model.value,
    file,
    'json',
    { providerOptions: { language: language.value } },
  )
}

async function validateAndUseForVoiceConversation() {
  activationError.value = ''
  isStarting.value = true
  const previousProviderId = hearingStore.activeTranscriptionProvider
  try {
    const startResult = await startLocalVoiceService('sensevoice')
    if (!startResult.ok) {
      activationError.value = t(`settings.pages.providers.provider.sensevoice-local.settings.start_errors.${startResult.errorCode}`)
      return
    }

    await providersStore.disposeProviderInstance(providerId)
    await validateConfiguration()
    if (!isValid.value) {
      activationError.value = t('settings.pages.providers.provider.sensevoice-local.settings.activation_failed')
      return
    }

    hearingStore.activeTranscriptionProvider = providerId
    hearingStore.activeTranscriptionModel = model.value
    hearingStore.activeCustomModelName = model.value
    notifyVoiceSettingsChanged([
      voiceSettingsStorageKeys.providerCredentials,
      voiceSettingsStorageKeys.activeTranscriptionProvider,
      voiceSettingsStorageKeys.activeTranscriptionModel,
      voiceSettingsStorageKeys.activeTranscriptionCustomModel,
    ])

    if (previousProviderId === QWEN3_ASR_LOCAL_PROVIDER_ID)
      await stopLocalVoiceService('qwen3-asr')
  }
  finally {
    isStarting.value = false
  }
}

function resetSenseVoiceSettings() {
  handleResetSettings()
  activationError.value = ''
}

onMounted(async () => {
  providersStore.initializeProvider(providerId)
  await providersStore.fetchModelsForProvider(providerId)
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <div flex="~ col md:row gap-6">
      <ProviderSettingsContainer class="w-full md:w-[40%]">
        <Alert type="info">
          <template #title>
            {{ t('settings.pages.providers.provider.sensevoice-local.settings.local_only_title') }}
          </template>
          <template #content>
            {{ t('settings.pages.providers.provider.sensevoice-local.settings.local_only_description') }}
          </template>
        </Alert>

        <ProviderBasicSettings
          :title="t('settings.pages.providers.provider.sensevoice-local.settings.configuration_title')"
          :description="t('settings.pages.providers.provider.sensevoice-local.settings.configuration_description')"
          :on-reset="resetSenseVoiceSettings"
        >
          <FieldCombobox
            v-model="model"
            :label="t('settings.pages.providers.provider.sensevoice-local.settings.model_label')"
            :description="t('settings.pages.providers.provider.sensevoice-local.settings.model_description')"
            :options="modelOptions"
            :searchable="false"
          />
          <FieldCombobox
            v-model="language"
            :label="t('settings.pages.providers.provider.sensevoice-local.settings.language_label')"
            :description="t('settings.pages.providers.provider.sensevoice-local.settings.language_description')"
            :options="languageOptions"
            :searchable="false"
          />
        </ProviderBasicSettings>

        <ProviderAdvancedSettings
          :title="t('settings.pages.providers.provider.sensevoice-local.settings.endpoint_title')"
          :initial-visible="true"
        >
          <ProviderBaseUrlInput
            v-model="baseUrl"
            :label="t('settings.pages.providers.provider.sensevoice-local.settings.endpoint_label')"
            :description="t('settings.pages.providers.provider.sensevoice-local.settings.endpoint_description')"
            :placeholder="SENSEVOICE_LOCAL_DEFAULT_BASE_URL"
            required
          />
        </ProviderAdvancedSettings>

        <Alert v-if="isValid && isValidating === 0" type="success">
          <template #title>
            {{ t('settings.pages.providers.provider.sensevoice-local.settings.ready_title') }}
          </template>
          <template #content>
            {{ t('settings.pages.providers.provider.sensevoice-local.settings.ready_description') }}
          </template>
        </Alert>
        <Alert v-else-if="!isValid && isValidating === 0 && validationMessage" type="error">
          <template #title>
            {{ t('settings.pages.providers.provider.sensevoice-local.settings.unavailable_title') }}
          </template>
          <template #content>
            {{ validationMessage }}
          </template>
        </Alert>

        <Button :disabled="isStarting || isValidating > 0" @click="validateAndUseForVoiceConversation">
          {{ isStarting
            ? t('settings.pages.providers.provider.sensevoice-local.settings.starting_button')
            : t('settings.pages.providers.provider.sensevoice-local.settings.validate_and_activate_button') }}
        </Button>
        <p v-if="activationError" class="text-sm text-red-600 dark:text-red-300">
          {{ activationError }}
        </p>
      </ProviderSettingsContainer>

      <div flex="~ col gap-6" class="w-full md:w-[60%]">
        <TranscriptionPlayground :generate-transcription="generateTranscription" :api-key-configured="isValid" />
      </div>
    </div>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
