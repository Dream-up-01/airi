<script setup lang="ts">
import { electron } from '@proj-airi/electron-eventa'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { HearingConfigDialog } from '@proj-airi/stage-ui/components'
import { useAudioAnalyzer, useAudioContextFromStream } from '@proj-airi/stage-ui/composables'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useAsyncState } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, watch } from 'vue'

const show = defineModel('show', { type: Boolean, default: false })

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { enabled, stream } = storeToRefs(settingsAudioDeviceStore)

const getMediaAccessStatus = useElectronEventaInvoke(electron.systemPreferences.getMediaAccessStatus)
const { state: mediaAccessStatus, execute: refreshMediaAccessStatus } = useAsyncState(() => getMediaAccessStatus(['microphone']), 'not-determined')

const { initialize, dispose, pause } = useAudioContextFromStream(stream)
const { volumeLevel, startAnalyzer, stopAnalyzer } = useAudioAnalyzer()
let analyzerSource: MediaStreamAudioSourceNode | undefined
let analyzerGeneration = 0

// Enabling the microphone is the terminal action for this compact drawer.
// Leaving the portalled drawer open keeps its invisible overlay above the
// stage voice controls, so the visible push-to-interrupt button cannot receive
// pointer input. Close only on the disabled -> enabled edge; reopening the
// drawer while the microphone is already active still allows device changes.
watch(enabled, (isEnabled, wasEnabled) => {
  if (isEnabled && !wasEnabled)
    show.value = false
})

// NOTICE: Do not call `startStream()` / `stopStream()` from this component.
//
// `useSettingsAudioDevice()` already owns the mic stream lifecycle via the persisted `enabled` state.
// We previously toggled the stream here as well, which introduced a second lifecycle controller: the
// dialog could recreate the MediaStream while the page-level transcription pipeline still believed
// the old session was active.
//
// That produced the "VAD still works, but no transcript arrives" failure after retoggling the mic.
//
// This component should only react to the current stream to drive analyzer UI state.
function stopInputAnalyzer() {
  analyzerGeneration += 1
  analyzerSource?.disconnect()
  analyzerSource = undefined
  stopAnalyzer()
  pause()
}

watch([enabled, stream], async ([isEnabled, currentStream]) => {
  stopInputAnalyzer()
  if (!isEnabled || !currentStream)
    return

  const generation = analyzerGeneration
  const context = await initialize()
  if (generation !== analyzerGeneration || !enabled.value || stream.value !== currentStream)
    return

  if (context.state === 'suspended')
    await context.resume()
  const analyzer = startAnalyzer(context)
  if (!analyzer)
    return

  analyzerSource = context.createMediaStreamSource(currentStream)
  analyzerSource.connect(analyzer)
}, { immediate: true })

onMounted(async () => {
  await refreshMediaAccessStatus()
})

onUnmounted(async () => {
  stopInputAnalyzer()
  await dispose()
})
</script>

<template>
  <HearingConfigDialog
    v-model:show="show"
    :granted="mediaAccessStatus !== 'denied' && mediaAccessStatus !== 'restricted'"
    :volume-level="volumeLevel"
  >
    <slot />
  </HearingConfigDialog>
</template>
