<script setup lang="ts">
import type { MiniMaxVoiceCloneRequest, MiniMaxVoiceCloneResult } from '@proj-airi/stage-ui/libs/minimax-voice-clone'

import { MiniMaxVoiceCloneError, minimaxVoiceCloneLimits } from '@proj-airi/stage-ui/libs/minimax-voice-clone'
import { Button, FieldCheckbox, FieldInput, FieldInputFile } from '@proj-airi/ui'
import { computed, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

type CloneInput = Omit<MiniMaxVoiceCloneRequest, 'apiKey'>

const props = defineProps<{
  apiKeyConfigured: boolean
  model: 'speech-2.8-turbo' | 'speech-2.8-hd'
  cloneVoice: (input: CloneInput) => Promise<MiniMaxVoiceCloneResult>
}>()

const emit = defineEmits<{
  created: [result: MiniMaxVoiceCloneResult]
}>()

const { t } = useI18n()
const sourceFiles = shallowRef<File[]>()
const promptFiles = shallowRef<File[]>()
const promptText = shallowRef('木须色拉还有经典苏乐达,你随便挑吧.')
const voiceId = shallowRef(`AiriFirefly${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`)
const generatePreview = shallowRef(false)
const previewText = shallowRef('你好，我是 AIRI，很高兴和你聊天。')
const consentConfirmed = shallowRef(false)
const isCloning = shallowRef(false)
const errorCode = shallowRef<string>()
const previewAudioUrl = shallowRef<string>()
let activeController: AbortController | undefined

const sourceAudio = computed(() => sourceFiles.value?.[0])
const promptAudio = computed(() => promptFiles.value?.[0])
const canClone = computed(() => {
  return props.apiKeyConfigured
    && !!sourceAudio.value
    && !!promptAudio.value
    && !!promptText.value.trim()
    && !!voiceId.value.trim()
    && consentConfirmed.value
    && !isCloning.value
})

function readAudioDuration(file: File, fallbackCode: 'invalid-source-audio' | 'invalid-prompt-audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio')
    const objectUrl = URL.createObjectURL(file)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(audio.duration)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new MiniMaxVoiceCloneError(fallbackCode))
    }
    audio.src = objectUrl
  })
}

function toSafeErrorCode(error: unknown): string {
  return error instanceof MiniMaxVoiceCloneError ? error.code : 'network-failed'
}

async function clone() {
  if (!canClone.value || !sourceAudio.value || !promptAudio.value)
    return

  errorCode.value = undefined
  previewAudioUrl.value = undefined
  isCloning.value = true
  activeController = new AbortController()

  try {
    const [sourceDurationSeconds, promptDurationSeconds] = await Promise.all([
      readAudioDuration(sourceAudio.value, 'invalid-source-audio'),
      readAudioDuration(promptAudio.value, 'invalid-prompt-audio'),
    ])
    const result = await props.cloneVoice({
      sourceAudio: sourceAudio.value,
      sourceDurationSeconds,
      promptAudio: promptAudio.value,
      promptDurationSeconds,
      promptText: promptText.value,
      voiceId: voiceId.value,
      previewText: generatePreview.value ? previewText.value : undefined,
      previewModel: props.model,
      signal: activeController.signal,
    })
    previewAudioUrl.value = result.previewAudioUrl
    sourceFiles.value = undefined
    promptFiles.value = undefined
    promptText.value = ''
    consentConfirmed.value = false
    emit('created', result)
  }
  catch (error) {
    errorCode.value = toSafeErrorCode(error)
  }
  finally {
    isCloning.value = false
    activeController = undefined
  }
}

onScopeDispose(() => activeController?.abort())
</script>

<template>
  <section class="flex flex-col gap-5 border border-neutral-200 rounded-xl p-5 dark:border-neutral-800">
    <div class="flex flex-col gap-1">
      <h3 class="text-base font-semibold">
        {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.title') }}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.description') }}
      </p>
    </div>

    <div class="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
      {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.privacy_note') }}
    </div>

    <FieldInputFile
      v-model="sourceFiles"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.source_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.source_description', { min: minimaxVoiceCloneLimits.sourceMinDurationSeconds, max: minimaxVoiceCloneLimits.sourceMaxDurationSeconds / 60 })"
      accept="audio/wav,audio/mpeg,audio/mp4,.wav,.mp3,.m4a"
      :placeholder="t('settings.pages.providers.provider.minimax-speech.settings.clone.source_placeholder')"
    />

    <FieldInputFile
      v-model="promptFiles"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.prompt_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.prompt_description', { max: minimaxVoiceCloneLimits.promptMaxDurationSeconds })"
      accept="audio/wav,audio/mpeg,audio/mp4,.wav,.mp3,.m4a"
      :placeholder="t('settings.pages.providers.provider.minimax-speech.settings.clone.prompt_placeholder')"
    />

    <FieldInput
      v-model="promptText"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.prompt_text_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.prompt_text_description')"
      :placeholder="t('settings.pages.providers.provider.minimax-speech.settings.clone.prompt_text_placeholder')"
      required
      :single-line="false"
    />

    <FieldInput
      v-model="voiceId"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.voice_id_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.voice_id_description')"
      required
    />

    <FieldCheckbox
      v-model="generatePreview"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.preview_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.preview_description')"
    />

    <FieldInput
      v-if="generatePreview"
      v-model="previewText"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.preview_text_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.preview_text_description')"
      :single-line="false"
    />

    <FieldCheckbox
      v-model="consentConfirmed"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.consent_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.consent_description')"
    />

    <p v-if="!apiKeyConfigured" class="text-sm text-amber-700 dark:text-amber-300">
      {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.api_key_required') }}
    </p>
    <p v-if="errorCode" class="text-sm text-red-600 dark:text-red-300">
      {{ t(`settings.pages.providers.provider.minimax-speech.settings.clone.errors.${errorCode}`) }}
    </p>

    <audio v-if="previewAudioUrl" :src="previewAudioUrl" controls preload="none" class="w-full" />

    <Button :loading="isCloning" :disabled="!canClone" size="lg" @click="clone">
      {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.submit') }}
    </Button>
  </section>
</template>
