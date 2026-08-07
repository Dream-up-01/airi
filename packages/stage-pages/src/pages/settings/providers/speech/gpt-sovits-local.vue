<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import {
  Alert,
  ProviderAdvancedSettings,
  ProviderBaseUrlInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  SpeechPlayground,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { notifyVoiceSettingsChanged, voiceSettingsStorageKeys } from '@proj-airi/stage-ui/services/voice-settings-sync'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import {
  GPT_SOVITS_LOCAL_DEFAULT_BASE_URL,
  GPT_SOVITS_LOCAL_DEFAULT_MODEL,
  GPT_SOVITS_LOCAL_DEFAULT_VOICE,
  GPT_SOVITS_LOCAL_PROVIDER_ID,
  useProvidersStore,
} from '@proj-airi/stage-ui/stores/providers'
import { useSpeechOutputRoutingStore } from '@proj-airi/stage-ui/stores/speech-output-routing'
import { FieldCombobox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, shallowRef } from 'vue'

import { startLocalVoiceService } from '../../../../composables/use-local-voice-service-start'
import {
  isManagedLocalVoiceServiceEndpoint,
  stopAndDisposePreviousVoiceService,
} from '../../../../composables/use-local-voice-service-switch'

const providerId = GPT_SOVITS_LOCAL_PROVIDER_ID
const speechStore = useSpeechStore()
const speechOutputRoutingStore = useSpeechOutputRoutingStore()
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
  get: () => (providers.value[providerId]?.baseUrl as string | undefined) || GPT_SOVITS_LOCAL_DEFAULT_BASE_URL,
  set: (value: string) => {
    providers.value[providerId] = {
      ...providers.value[providerId],
      baseUrl: value,
    }
  },
})

const model = computed({
  get: () => (providers.value[providerId]?.model as string | undefined) || GPT_SOVITS_LOCAL_DEFAULT_MODEL,
  set: (value: string) => {
    providers.value[providerId] = {
      ...providers.value[providerId],
      model: value,
    }
  },
})

const voice = computed({
  get: () => (providers.value[providerId]?.voice as string | undefined) || GPT_SOVITS_LOCAL_DEFAULT_VOICE,
  set: (value: string) => {
    providers.value[providerId] = {
      ...providers.value[providerId],
      voice: value,
    }
  },
})

const modelOptions = computed(() => [{
  label: t('settings.pages.providers.provider.gpt-sovits-local.settings.model_name'),
  value: GPT_SOVITS_LOCAL_DEFAULT_MODEL,
}])

const voiceOptions = computed(() => [{
  label: t('settings.pages.providers.provider.gpt-sovits-local.settings.voice_name'),
  value: GPT_SOVITS_LOCAL_DEFAULT_VOICE,
}])

const availableVoices = computed(() => speechStore.availableVoices[providerId] ?? [])

async function generateSpeech(input: string, voiceId: string) {
  const provider = await providersStore.getProviderInstance<SpeechProvider<string>>(providerId)
  if (!provider)
    throw new Error('Failed to initialize the local GPT-SoVITS provider')

  try {
    return await speechStore.speech(
      provider,
      model.value,
      input,
      voiceId || voice.value,
      providersStore.getProviderConfig(providerId),
    )
  }
  catch (error) {
    // A cached successful validation must not keep the page green after the
    // loopback service exits. Re-check health before surfacing the synthesis
    // error so the existing provider state remains the single source of truth.
    await validateConfiguration()
    throw error
  }
}

async function validateAndActivate() {
  activationError.value = ''
  isStarting.value = true
  const previousProviderId = speechStore.activeSpeechProvider
  try {
    const previousService = await stopAndDisposePreviousVoiceService({
      previousProviderId,
      nextProviderId: providerId,
      serviceIdForProvider: previousId => previousId === providerId ? 'gpt-sovits' : undefined,
      disposeProvider: providerId => providersStore.disposeProviderInstance(providerId),
    })
    if (!previousService.ok) {
      activationError.value = t('settings.pages.providers.provider.gpt-sovits-local.settings.activation_failed')
      return
    }

    if (isManagedLocalVoiceServiceEndpoint('gpt-sovits', baseUrl.value)) {
      const startResult = await startLocalVoiceService('gpt-sovits')
      if (!startResult.ok) {
        activationError.value = t(`settings.pages.providers.provider.gpt-sovits-local.settings.start_errors.${startResult.errorCode}`)
        return
      }
    }

    await providersStore.disposeProviderInstance(providerId)
    await validateConfiguration()
    if (!isValid.value) {
      activationError.value = t('settings.pages.providers.provider.gpt-sovits-local.settings.activation_failed')
      return
    }

    await speechStore.loadVoicesForProvider(providerId, model.value)
    speechStore.activeSpeechProvider = providerId
    speechStore.activeSpeechModel = model.value
    speechStore.activeSpeechVoiceId = voice.value
    speechStore.activeSpeechVoice = availableVoices.value.find(item => item.id === voice.value)
    speechOutputRoutingStore.setProfile('text-chat', {
      providerId,
      modelId: model.value,
      voiceId: voice.value,
    })
    speechOutputRoutingStore.setProfile('voice-conversation', {
      providerId,
      modelId: model.value,
      voiceId: voice.value,
    })
    notifyVoiceSettingsChanged([
      voiceSettingsStorageKeys.providerCredentials,
      voiceSettingsStorageKeys.activeSpeechProvider,
      voiceSettingsStorageKeys.activeSpeechModel,
      voiceSettingsStorageKeys.activeSpeechVoice,
      voiceSettingsStorageKeys.textChatSpeechProfile,
      voiceSettingsStorageKeys.voiceConversationSpeechProfile,
    ])
  }
  finally {
    isStarting.value = false
  }
}

function resetLocalSettings() {
  handleResetSettings()
  activationError.value = ''
}

onMounted(async () => {
  providersStore.initializeProvider(providerId)
  await providersStore.fetchModelsForProvider(providerId)
  await speechStore.loadVoicesForProvider(providerId, model.value)
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
            {{ t('settings.pages.providers.provider.gpt-sovits-local.settings.local_only_title') }}
          </template>
          <template #content>
            {{ t('settings.pages.providers.provider.gpt-sovits-local.settings.local_only_description') }}
          </template>
        </Alert>

        <ProviderBasicSettings
          :title="t('settings.pages.providers.provider.gpt-sovits-local.settings.configuration_title')"
          :description="t('settings.pages.providers.provider.gpt-sovits-local.settings.configuration_description')"
          :on-reset="resetLocalSettings"
        >
          <FieldCombobox
            v-model="model"
            :label="t('settings.pages.providers.provider.gpt-sovits-local.settings.model_label')"
            :options="modelOptions"
            :searchable="false"
          />
          <FieldCombobox
            v-model="voice"
            :label="t('settings.pages.providers.provider.gpt-sovits-local.settings.voice_label')"
            :options="voiceOptions"
            :searchable="false"
          />
        </ProviderBasicSettings>

        <ProviderAdvancedSettings
          :title="t('settings.pages.providers.provider.gpt-sovits-local.settings.endpoint_title')"
          :initial-visible="true"
        >
          <ProviderBaseUrlInput
            v-model="baseUrl"
            :label="t('settings.pages.providers.provider.gpt-sovits-local.settings.endpoint_label')"
            :description="t('settings.pages.providers.provider.gpt-sovits-local.settings.endpoint_description')"
            :placeholder="GPT_SOVITS_LOCAL_DEFAULT_BASE_URL"
            required
          />
        </ProviderAdvancedSettings>

        <Alert v-if="isValid && isValidating === 0" type="success">
          <template #title>
            {{ t('settings.pages.providers.provider.gpt-sovits-local.settings.activation_ready_title') }}
          </template>
          <template #content>
            {{ t('settings.pages.providers.provider.gpt-sovits-local.settings.activation_ready_description') }}
          </template>
        </Alert>
        <Alert v-else-if="!isValid && isValidating === 0 && validationMessage" type="error">
          <template #title>
            {{ t('settings.pages.providers.provider.gpt-sovits-local.settings.activation_failed') }}
          </template>
          <template #content>
            {{ validationMessage }}
          </template>
        </Alert>

        <button
          type="button"
          class="rounded-lg bg-primary px-4 py-2 text-sm text-white font-medium disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="isStarting || isValidating > 0"
          @click="validateAndActivate"
        >
          {{ isStarting
            ? t('settings.pages.providers.provider.gpt-sovits-local.settings.starting_button')
            : t('settings.pages.providers.provider.gpt-sovits-local.settings.activate_button') }}
        </button>
        <p v-if="activationError" class="text-sm text-red-600 dark:text-red-300">
          {{ activationError }}
        </p>
      </ProviderSettingsContainer>

      <div flex="~ col gap-6" class="w-full md:w-[60%]">
        <SpeechPlayground
          :available-voices="availableVoices"
          :default-voice="voice"
          :generate-speech="generateSpeech"
          :api-key-configured="isValid"
          :voices-loading="speechStore.isLoadingSpeechProviderVoices"
          default-text="你好，我是AIRI。很高兴和你聊天。"
        />
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
