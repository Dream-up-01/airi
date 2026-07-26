<script setup lang="ts">
import type { VoiceConversationDiagnosticsSnapshot } from '@proj-airi/stage-ui/domains/voiceConversation'

import { IS_DEV } from '@proj-airi/stage-shared'
import {
  onVoiceRuntimeDiagnosticsSnapshot,
  requestVoiceRuntimeDiagnostics,
} from '@proj-airi/stage-ui/services/voice-runtime-diagnostics'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useVoiceConversationStore } from '@proj-airi/stage-ui/stores/voiceConversation'
import { useVoiceStyleRuntimeStore } from '@proj-airi/stage-ui/stores/voiceStyleRuntime'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showDevelopmentDiagnostics = IS_DEV
const hearingStore = useHearingStore()
const speechStore = useSpeechStore()
const voiceStore = useVoiceConversationStore()
const voiceStyleRuntimeStore = useVoiceStyleRuntimeStore()
const hearingPipeline = useHearingSpeechInputPipeline()
const { activeTranscriptionProvider, activeTranscriptionModel } = storeToRefs(hearingStore)
const { activeSpeechProvider, activeSpeechModel, activeSpeechVoiceId } = storeToRefs(speechStore)
const { supportsStreamInput } = storeToRefs(hearingPipeline)
const { latestResolution: latestVoiceStyleResolution } = storeToRefs(voiceStyleRuntimeStore)
const runtimeSnapshot = shallowRef<VoiceConversationDiagnosticsSnapshot>()
let stopRuntimeDiagnostics: (() => void) | undefined

onMounted(() => {
  stopRuntimeDiagnostics = onVoiceRuntimeDiagnosticsSnapshot((snapshot) => {
    runtimeSnapshot.value = snapshot
  })
  requestVoiceRuntimeDiagnostics()
})

onUnmounted(() => stopRuntimeDiagnostics?.())

const diagnosticInputProvider = computed(() => runtimeSnapshot.value?.inputProviderId ?? activeTranscriptionProvider.value)
const diagnosticInputModel = computed(() => runtimeSnapshot.value?.inputModelId ?? activeTranscriptionModel.value)
const diagnosticInputStreaming = computed(() => runtimeSnapshot.value?.inputSupportsStreaming ?? supportsStreamInput.value)
const diagnosticOutputProvider = computed(() => runtimeSnapshot.value?.outputProviderId ?? activeSpeechProvider.value)
const diagnosticOutputModel = computed(() => runtimeSnapshot.value?.outputModelId ?? activeSpeechModel.value)
const diagnosticVoiceId = computed(() => runtimeSnapshot.value?.voiceId ?? activeSpeechVoiceId.value)
const lastErrorCode = computed(() => {
  const errorCode = runtimeSnapshot.value
    ? runtimeSnapshot.value.lastErrorCode
    : voiceStore.session?.lastErrorCode
  return errorCode ?? t('settings.pages.modules.hearing.voice-conversation.diagnostics.none')
})
const ttsCapability = computed(() => {
  const capability = runtimeSnapshot.value?.ttsCapability
    ?? (activeSpeechProvider.value === 'minimax-speech' ? 'rest-aggregated' : 'not-declared')
  return t(`settings.pages.modules.hearing.voice-conversation.diagnostics.${capability}`)
})
const latencySummary = computed(() => {
  if (runtimeSnapshot.value) {
    return {
      asr: runtimeSnapshot.value.asrFirstPartialLatencyMs === undefined
        ? t('settings.pages.modules.hearing.voice-conversation.diagnostics.none')
        : `${runtimeSnapshot.value.asrFirstPartialLatencyMs} ms`,
      tts: runtimeSnapshot.value.ttsFirstAudioLatencyMs === undefined
        ? t('settings.pages.modules.hearing.voice-conversation.diagnostics.none')
        : `${runtimeSnapshot.value.ttsFirstAudioLatencyMs} ms`,
    }
  }

  const entries = voiceStore.timeline
  const start = entries.findLast(entry => entry.name === 'voice.vad.speech_start')
  const partial = start?.turnId
    ? entries.find(entry => entry.turnId === start.turnId && entry.name === 'voice.asr.first_partial')
    : undefined
  const request = entries.findLast(entry => entry.name === 'voice.tts.first_request')
  const audio = request?.turnId
    ? entries.find(entry => entry.turnId === request.turnId && entry.name === 'voice.tts.first_audio')
    : undefined

  return {
    asr: start && partial ? `${partial.at - start.at} ms` : t('settings.pages.modules.hearing.voice-conversation.diagnostics.none'),
    tts: request && audio ? `${audio.at - request.at} ms` : t('settings.pages.modules.hearing.voice-conversation.diagnostics.none'),
  }
})
const styleWarningKeys = computed(() => runtimeSnapshot.value?.styleWarningCodes
  ?? latestVoiceStyleResolution.value?.warnings.map(warning => warning.code)
  ?? [])
</script>

<template>
  <section class="flex flex-col gap-3 border border-neutral-200 rounded-xl bg-white/60 p-4 dark:border-neutral-700 dark:bg-neutral-900/40">
    <div>
      <h2 class="text-lg text-neutral-700 font-medium dark:text-neutral-200">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.title') }}
      </h2>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.description') }}
      </p>
    </div>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
      <dt class="text-neutral-500">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.asr') }}
      </dt>
      <dd class="break-all">
        {{ diagnosticInputProvider || '—' }} / {{ diagnosticInputModel || '—' }}
      </dd>
      <dt class="text-neutral-500">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.asr-streaming') }}
      </dt>
      <dd>
        {{ diagnosticInputStreaming ? t('settings.pages.modules.hearing.voice-conversation.diagnostics.supported') : t('settings.pages.modules.hearing.voice-conversation.diagnostics.not-supported') }}
      </dd>
      <dt class="text-neutral-500">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.tts') }}
      </dt>
      <dd class="break-all">
        {{ diagnosticOutputProvider || '—' }} / {{ diagnosticOutputModel || '—' }} / {{ diagnosticVoiceId || '—' }}
      </dd>
      <dt class="text-neutral-500">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.tts-streaming') }}
      </dt>
      <dd>
        {{ ttsCapability }}
      </dd>
      <dt class="text-neutral-500">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.last-error') }}
      </dt>
      <dd>
        {{ lastErrorCode }}
      </dd>
      <dt class="text-neutral-500">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.asr-latency') }}
      </dt>
      <dd>
        {{ latencySummary.asr }}
      </dd>
      <dt class="text-neutral-500">
        {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.tts-latency') }}
      </dt>
      <dd>
        {{ latencySummary.tts }}
      </dd>
      <template v-if="showDevelopmentDiagnostics">
        <dt class="text-neutral-500">
          {{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.style-warnings') }}
        </dt>
        <dd>
          <span v-if="styleWarningKeys.length === 0">{{ t('settings.pages.modules.hearing.voice-conversation.diagnostics.none') }}</span>
          <ul v-else class="list-disc pl-4">
            <li v-for="warningKey in styleWarningKeys" :key="warningKey">
              {{ t(`settings.pages.modules.hearing.voice-conversation.diagnostics.warnings.${warningKey}`) }}
            </li>
          </ul>
        </dd>
      </template>
    </dl>
  </section>
</template>
