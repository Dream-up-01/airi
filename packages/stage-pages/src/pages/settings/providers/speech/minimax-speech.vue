<script setup lang="ts">
import type { MiniMaxVoiceCloneRequest, MiniMaxVoiceCloneResult } from '@proj-airi/stage-ui/libs/minimax-voice-clone'
import type { MiniMaxAvailableVoice } from '@proj-airi/stage-ui/stores/providers/minimax-speech'
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import {
  Alert,
  ProviderAdvancedSettings,
  ProviderApiKeyInput,
  ProviderBaseUrlInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  SpeechPlayground,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { cloneMiniMaxVoice } from '@proj-airi/stage-ui/libs/minimax-voice-clone'
import { notifyVoiceSettingsChanged, voiceSettingsStorageKeys } from '@proj-airi/stage-ui/services/voice-settings-sync'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { GPT_SOVITS_LOCAL_PROVIDER_ID, useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { listMiniMaxAvailableVoices } from '@proj-airi/stage-ui/stores/providers/minimax-speech'
import { useSpeechOutputRoutingStore } from '@proj-airi/stage-ui/stores/speech-output-routing'
import { FieldCombobox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'

import MiniMaxExistingVoicePanel from './components/MiniMaxExistingVoicePanel.vue'
import MiniMaxVoiceClonePanel from './components/MiniMaxVoiceClonePanel.vue'

import { stopLocalVoiceService } from '../../../../composables/use-local-voice-service-start'

const providerId = 'minimax-speech'
const defaultModel = 'speech-2.8-turbo'
const speechStore = useSpeechStore()
const speechOutputRoutingStore = useSpeechOutputRoutingStore()
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore)
const activationError = shallowRef('')
const activationReady = shallowRef(false)
const isActivating = shallowRef(false)
const accountVoices = shallowRef<MiniMaxAvailableVoice[]>([])
const trustedSessionVoiceIds = new Set<string>()
let voiceCatalogAbortController: AbortController | undefined

const {
  t,
  router,
  providerMetadata,
  apiKey,
  baseUrl,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  validateConfiguration,
} = useProviderValidation(providerId)

const apiKeyConfigured = computed(() => apiKey.value.trim().length > 0)

function resetActivationState() {
  activationError.value = ''
  activationReady.value = false
}

const model = computed({
  get: () => (providers.value[providerId]?.model as string | undefined) || defaultModel,
  set: (value: string) => {
    resetActivationState()
    providers.value[providerId] = {
      ...providers.value[providerId],
      model: value,
    }
  },
})

const voice = computed({
  get: () => (providers.value[providerId]?.voice as string | undefined) || '',
  set: (value: string) => {
    resetActivationState()
    providers.value[providerId] = {
      ...providers.value[providerId],
      voice: value,
    }
  },
})

interface MiniMaxCustomVoice {
  id: string
  name: string
}

const customVoices = computed<MiniMaxCustomVoice[]>({
  get: () => {
    const configuredVoices = providers.value[providerId]?.customVoices
    if (!Array.isArray(configuredVoices))
      return []

    return configuredVoices
      .filter((item): item is MiniMaxCustomVoice => {
        return !!item
          && typeof item === 'object'
          && typeof (item as MiniMaxCustomVoice).id === 'string'
          && typeof (item as MiniMaxCustomVoice).name === 'string'
      })
      .filter(item => item.id.trim().length > 0)
  },
  set: (value) => {
    providers.value[providerId] = {
      ...providers.value[providerId],
      customVoices: value.map(item => ({ id: item.id, name: item.name })),
    }
  },
})

const modelOptions = computed(() => {
  const models = providersStore.getModelsForProvider(providerId)
  return (models.length > 0
    ? models
    : [
        { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo' },
        { id: 'speech-2.8-hd', name: 'Speech 2.8 HD' },
      ]).map(item => ({ label: item.name, value: item.id }))
})

const availableVoices = computed(() => {
  const knownVoices = speechStore.availableVoices[providerId] ?? []
  const voices = [
    ...accountVoices.value.map(item => ({
      id: item.id,
      name: item.name,
      provider: providerId,
      languages: [],
    })),
    ...knownVoices,
    ...customVoices.value
      .map(item => ({
        id: item.id,
        name: item.name,
        provider: providerId,
        languages: [{ code: 'zh', title: 'Chinese' }],
      })),
  ]
  const uniqueVoices = new Map(voices.map(item => [item.id, item]))
  return [...uniqueVoices.values()]
})
const voiceOptions = computed(() => availableVoices.value.map(item => ({
  label: item.name,
  value: item.id,
})))

async function generateSpeech(input: string, voiceId: string) {
  const provider = await providersStore.getProviderInstance<SpeechProvider<string>>(providerId)
  if (!provider)
    throw new Error('Failed to initialize the MiniMax speech provider')

  return await speechStore.speech(
    provider,
    model.value,
    input,
    voiceId || voice.value,
    providersStore.getProviderConfig(providerId),
  )
}

async function refreshAccountVoices(options: { showError: boolean }): Promise<boolean> {
  voiceCatalogAbortController?.abort()
  const controller = new AbortController()
  voiceCatalogAbortController = controller

  try {
    accountVoices.value = await listMiniMaxAvailableVoices(
      providersStore.getProviderConfig(providerId),
      { signal: controller.signal },
    )
    return true
  }
  catch {
    if (!controller.signal.aborted && options.showError) {
      activationError.value = t('settings.pages.providers.provider.minimax-speech.settings.voice_catalog_failed')
    }
    return false
  }
  finally {
    if (voiceCatalogAbortController === controller)
      voiceCatalogAbortController = undefined
  }
}

async function validateAndUseForVoiceConversation(): Promise<boolean> {
  resetActivationState()
  if (!voice.value) {
    activationError.value = t('settings.pages.providers.provider.minimax-speech.settings.voice_required')
    return false
  }

  const previousProviderId = speechStore.activeSpeechProvider
  isActivating.value = true
  try {
    await validateConfiguration()
    if (!isValid.value) {
      activationError.value = t('settings.pages.providers.provider.minimax-speech.settings.activation_failed')
      return false
    }

    const catalogLoaded = await refreshAccountVoices({ showError: true })
    if (!catalogLoaded)
      return false

    const selectedVoiceIsAvailable = accountVoices.value.some(item => item.id === voice.value)
      || trustedSessionVoiceIds.has(voice.value)
    if (!selectedVoiceIsAvailable) {
      activationError.value = t('settings.pages.providers.provider.minimax-speech.settings.voice_unavailable', { id: voice.value })
      return false
    }

    speechStore.activeSpeechProvider = providerId
    speechStore.activeSpeechModel = model.value
    speechStore.activeSpeechVoiceId = voice.value
    await speechStore.loadVoicesForProvider(providerId, model.value)
    speechStore.activeSpeechVoice = availableVoices.value.find(item => item.id === voice.value)
    speechOutputRoutingStore.setProfile('voice-conversation', {
      providerId,
      modelId: model.value,
      voiceId: voice.value,
    })
    speechOutputRoutingStore.setProfile('text-chat', {
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
    if (previousProviderId === GPT_SOVITS_LOCAL_PROVIDER_ID)
      await stopLocalVoiceService('gpt-sovits')
    activationReady.value = true
    return true
  }
  finally {
    isActivating.value = false
  }
}

function resetMiniMaxSettings() {
  handleResetSettings()
  resetActivationState()
  accountVoices.value = []
}

async function cloneVoice(input: Omit<MiniMaxVoiceCloneRequest, 'apiKey'>) {
  return await cloneMiniMaxVoice({
    ...input,
    apiKey: apiKey.value,
    baseUrl: baseUrl.value,
  })
}

async function registerCustomVoice(voiceId: string) {
  const previousCustomVoices = customVoices.value
  const previousVoice = voice.value
  const label = t('settings.pages.providers.provider.minimax-speech.settings.clone.custom_voice_name', { id: voiceId })
  customVoices.value = [
    ...customVoices.value.filter(item => item.id !== voiceId),
    { id: voiceId, name: label },
  ]
  voice.value = voiceId
  const activated = await validateAndUseForVoiceConversation()
  if (!activated) {
    customVoices.value = previousCustomVoices
    providers.value[providerId] = {
      ...providers.value[providerId],
      voice: previousVoice,
    }
    throw new Error('MiniMax voice registration failed')
  }
}

async function registerClonedVoice(result: MiniMaxVoiceCloneResult) {
  trustedSessionVoiceIds.add(result.voiceId)
  try {
    await registerCustomVoice(result.voiceId)
  }
  catch (error) {
    trustedSessionVoiceIds.delete(result.voiceId)
    throw error
  }
}

watch([apiKey, baseUrl], () => {
  voiceCatalogAbortController?.abort()
  accountVoices.value = []
  resetActivationState()
})

onMounted(async () => {
  providersStore.initializeProvider(providerId)
  await providersStore.fetchModelsForProvider(providerId)
  await speechStore.loadVoicesForProvider(providerId, model.value)
  if (apiKey.value.trim() && baseUrl.value.trim())
    await refreshAccountVoices({ showError: false })
})

onUnmounted(() => voiceCatalogAbortController?.abort())
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
        <Alert type="warning">
          <template #title>
            {{ t('settings.pages.providers.provider.minimax-speech.settings.cloud_title') }}
          </template>
          <template #content>
            {{ t('settings.pages.providers.provider.minimax-speech.settings.cloud_description') }}
          </template>
        </Alert>

        <ProviderBasicSettings
          :title="t('settings.pages.providers.provider.minimax-speech.settings.configuration_title')"
          :description="t('settings.pages.providers.provider.minimax-speech.settings.configuration_description')"
          :on-reset="resetMiniMaxSettings"
        >
          <ProviderApiKeyInput v-model="apiKey" :provider-name="providerMetadata?.localizedName" />
          <FieldCombobox
            v-model="model"
            :label="t('settings.pages.providers.provider.minimax-speech.settings.model_label')"
            :options="modelOptions"
            :searchable="false"
          />
          <FieldCombobox
            v-model="voice"
            :label="t('settings.pages.providers.provider.minimax-speech.settings.voice_label')"
            :description="t('settings.pages.providers.provider.minimax-speech.settings.voice_description')"
            :options="voiceOptions"
            :searchable="true"
          />
        </ProviderBasicSettings>

        <ProviderAdvancedSettings
          :title="t('settings.pages.providers.provider.minimax-speech.settings.endpoint_title')"
          :initial-visible="true"
        >
          <ProviderBaseUrlInput
            v-model="baseUrl"
            :label="t('settings.pages.providers.provider.minimax-speech.settings.endpoint_label')"
            :description="t('settings.pages.providers.provider.minimax-speech.settings.endpoint_description')"
            required
          />
        </ProviderAdvancedSettings>

        <Alert v-if="activationReady && !isActivating" type="success">
          <template #title>
            {{ t('settings.pages.providers.provider.minimax-speech.settings.activation_ready_title') }}
          </template>
          <template #content>
            {{ t('settings.pages.providers.provider.minimax-speech.settings.activation_ready_description') }}
          </template>
        </Alert>
        <Alert v-else-if="!isValid && isValidating === 0 && validationMessage" type="error">
          <template #title>
            {{ t('settings.pages.providers.provider.minimax-speech.settings.activation_failed') }}
          </template>
          <template #content>
            {{ validationMessage }}
          </template>
        </Alert>

        <button
          type="button"
          class="rounded-lg bg-primary px-4 py-2 text-sm text-white font-medium disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="isValidating > 0 || isActivating"
          @click="validateAndUseForVoiceConversation"
        >
          {{ t('settings.pages.providers.provider.minimax-speech.settings.activate_button') }}
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
          :voices-loading="speechStore.isLoadingSpeechProviderVoices || isActivating"
          default-text="你好，我是AIRI。现在开始语音通话测试。"
        />

        <MiniMaxVoiceClonePanel
          :api-key-configured="apiKeyConfigured"
          :model="model === 'speech-2.8-hd' ? 'speech-2.8-hd' : 'speech-2.8-turbo'"
          :clone-voice="cloneVoice"
          @created="registerClonedVoice"
        />

        <MiniMaxExistingVoicePanel :register-voice="registerCustomVoice" />
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
