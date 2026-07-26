<script setup lang="ts">
import type { LocalVoiceServiceId, LocalVoiceServiceStartErrorCode } from '@proj-airi/stage-ui/domains/localVoiceServices'

import { RadioCardSimple } from '@proj-airi/stage-ui/components'
import { useAnalytics } from '@proj-airi/stage-ui/composables'
import { notifyVoiceSettingsChanged, voiceSettingsStorageKeys } from '@proj-airi/stage-ui/services/voice-settings-sync'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import {
  QWEN3_ASR_LOCAL_DEFAULT_MODEL,
  QWEN3_ASR_LOCAL_PROVIDER_ID,
  SENSEVOICE_LOCAL_DEFAULT_MODEL,
  SENSEVOICE_LOCAL_PROVIDER_ID,
  useProvidersStore,
} from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { startLocalVoiceService, stopLocalVoiceService } from '../../../../composables/use-local-voice-service-start'

type ActivationErrorCode = LocalVoiceServiceStartErrorCode | 'validation_failed' | 'unexpected'
type ActivationNoticeCode = 'previous-service-not-managed' | 'previous-service-stop-failed'

interface DeclaredLocalAsrProfile {
  providerId: string
  modelId: string
  serviceId: LocalVoiceServiceId
  label: string
  description: string
}

const { t } = useI18n()
const hearingStore = useHearingStore()
const { activeTranscriptionModel, activeTranscriptionProvider } = storeToRefs(hearingStore)
const providersStore = useProvidersStore()
const { trackProviderClick } = useAnalytics()
const activatingProviderId = shallowRef<string>()
const activationErrorCode = shallowRef<ActivationErrorCode>()
const activationNoticeCode = shallowRef<ActivationNoticeCode>()

const profiles = computed<DeclaredLocalAsrProfile[]>(() => [
  {
    providerId: QWEN3_ASR_LOCAL_PROVIDER_ID,
    modelId: QWEN3_ASR_LOCAL_DEFAULT_MODEL,
    serviceId: 'qwen3-asr',
    label: t('settings.pages.modules.hearing.voice-conversation.local-asr.qwen-label'),
    description: t('settings.pages.providers.provider.qwen3-asr-local.description'),
  },
  {
    providerId: SENSEVOICE_LOCAL_PROVIDER_ID,
    modelId: SENSEVOICE_LOCAL_DEFAULT_MODEL,
    serviceId: 'sensevoice',
    label: t('settings.pages.modules.hearing.voice-conversation.local-asr.sensevoice-label'),
    description: t('settings.pages.providers.provider.sensevoice-local.description'),
  },
])

const activeProfile = computed(() => profiles.value.find(profile => (
  profile.providerId === activeTranscriptionProvider.value
  && profile.modelId === activeTranscriptionModel.value
)))

const activationError = computed(() => activationErrorCode.value
  ? t(`settings.pages.modules.hearing.voice-conversation.local-asr.errors.${activationErrorCode.value}`)
  : '')
const activationNotice = computed(() => activationNoticeCode.value
  ? t(`settings.pages.modules.hearing.voice-conversation.local-asr.notices.${activationNoticeCode.value}`)
  : '')

async function activate(profile: DeclaredLocalAsrProfile) {
  if (activatingProviderId.value)
    return

  const previousProfile = profiles.value.find(candidate => candidate.providerId === activeTranscriptionProvider.value)
  activatingProviderId.value = profile.providerId
  activationErrorCode.value = undefined
  activationNoticeCode.value = undefined
  trackProviderClick(profile.providerId, 'hearing')

  try {
    providersStore.initializeProvider(profile.providerId)

    const startResult = await startLocalVoiceService(profile.serviceId)
    if (!startResult.ok) {
      activationErrorCode.value = startResult.errorCode
      return
    }

    await providersStore.disposeProviderInstance(profile.providerId)
    const valid = await providersStore.validateProvider(profile.providerId, { force: true })
    if (!valid) {
      activationErrorCode.value = 'validation_failed'
      return
    }

    hearingStore.activeTranscriptionProvider = profile.providerId
    hearingStore.activeTranscriptionModel = profile.modelId
    hearingStore.activeCustomModelName = profile.modelId
    notifyVoiceSettingsChanged([
      voiceSettingsStorageKeys.providerCredentials,
      voiceSettingsStorageKeys.activeTranscriptionProvider,
      voiceSettingsStorageKeys.activeTranscriptionModel,
      voiceSettingsStorageKeys.activeTranscriptionCustomModel,
    ])

    if (previousProfile && previousProfile.serviceId !== profile.serviceId) {
      const stopResult = await stopLocalVoiceService(previousProfile.serviceId)
      if (!stopResult.ok)
        activationNoticeCode.value = 'previous-service-stop-failed'
      else if (!stopResult.stopped)
        activationNoticeCode.value = 'previous-service-not-managed'
      await providersStore.disposeProviderInstance(previousProfile.providerId)
    }
  }
  catch {
    activationErrorCode.value = 'unexpected'
  }
  finally {
    activatingProviderId.value = undefined
  }
}
</script>

<template>
  <section class="flex flex-col gap-3" :aria-busy="!!activatingProviderId">
    <div>
      <h2 class="text-lg text-neutral-700 font-medium dark:text-neutral-200">
        {{ t('settings.pages.modules.hearing.voice-conversation.local-asr.title') }}
      </h2>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {{ t('settings.pages.modules.hearing.voice-conversation.local-asr.description') }}
      </p>
    </div>

    <fieldset class="min-w-0 flex gap-4 overflow-x-auto scroll-smooth" role="radiogroup" :disabled="!!activatingProviderId">
      <RadioCardSimple
        v-for="profile in profiles"
        :id="profile.providerId"
        :key="profile.providerId"
        :model-value="activeTranscriptionProvider"
        name="declared-local-asr-provider"
        :value="profile.providerId"
        :title="profile.label"
        :description="profile.description"
        @click="activate(profile)"
      >
        <template #topRight>
          <div v-if="activatingProviderId === profile.providerId" class="animate-spin text-primary-600 dark:text-primary-300" i-solar:spinner-line-duotone />
        </template>
        <template #bottomRight>
          <span v-if="activeProfile?.providerId === profile.providerId" class="rounded bg-primary-100 px-1.5 py-0.5 text-xs text-primary-700 dark:bg-primary-900/60 dark:text-primary-200">
            {{ t('settings.pages.modules.hearing.voice-conversation.local-asr.selected') }}
          </span>
        </template>
      </RadioCardSimple>
    </fieldset>

    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('settings.pages.modules.hearing.voice-conversation.local-asr.selected-indicator') }}
    </p>

    <p v-if="activatingProviderId" role="status" class="text-sm text-primary-600 dark:text-primary-300">
      {{ t('settings.pages.modules.hearing.voice-conversation.local-asr.switching') }}
    </p>

    <p v-if="activationError" role="alert" class="text-sm text-red-600 dark:text-red-300">
      {{ activationError }}
    </p>

    <p v-if="activationNotice" role="status" class="text-sm text-amber-600 dark:text-amber-300">
      {{ activationNotice }}
    </p>

    <RouterLink class="w-fit text-sm text-primary-600 dark:text-primary-300 hover:underline" to="/settings/providers#transcription">
      {{ t('settings.pages.modules.hearing.voice-conversation.local-asr.configure') }}
    </RouterLink>
  </section>
</template>
