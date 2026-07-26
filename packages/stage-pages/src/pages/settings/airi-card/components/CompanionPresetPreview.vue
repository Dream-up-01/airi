<script setup lang="ts">
import type { CompanionModelBindingWarning } from '@proj-airi/stage-ui/domains/companion'
import type { CompanionPresetPreview } from '@proj-airi/stage-ui/stores/companion'

import { Button, Callout } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import CompanionPromptPreview from './CompanionPromptPreview.vue'

defineProps<{
  bindingWarnings: CompanionModelBindingWarning[]
  canActivate: boolean
  modelBindingSummary: string
  preview: CompanionPresetPreview
  replacementConfirmed: boolean
  willReplaceExistingCard: boolean
}>()

const emit = defineEmits<{
  activate: []
  confirmReplacement: []
}>()

const { t } = useI18n()
const isDevelopment = import.meta.env.DEV
</script>

<template>
  <div
    :class="[
      'rounded-lg p-4',
      'grid gap-3 sm:grid-cols-2',
      'bg-white/70 dark:bg-neutral-900/60',
    ]"
  >
    <div>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ preview.sourceName }} · v{{ preview.preset.version }}
      </p>
      <p :class="['mt-1 text-lg font-semibold']">
        {{ preview.preset.identity.name }}
      </p>
      <p :class="['mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
        {{ preview.preset.identity.description }}
      </p>
    </div>

    <div :class="['space-y-2 text-sm']">
      <p>
        <span :class="['text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.card.companion_import.personality') }}:</span>
        {{ preview.preset.behavior.personality.join('、') }}
      </p>
      <p>
        <span :class="['text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.card.companion_import.models') }}:</span>
        {{ modelBindingSummary }}
      </p>
      <p>
        <span :class="['text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.card.companion_import.prompt_sections') }}:</span>
        {{ preview.promptSections.length }}
      </p>
    </div>

    <Callout
      :class="['sm:col-span-2']"
      theme="lime"
      :label="t('settings.pages.card.companion_import.validation_success')"
    />

    <Callout
      v-if="bindingWarnings.length > 0"
      :class="['sm:col-span-2']"
      theme="orange"
      :label="t('settings.pages.card.companion_import.binding_warning')"
    >
      <ul :class="['list-disc space-y-1 pl-5 text-sm']">
        <li v-for="warning in bindingWarnings" :key="`${warning.binding}:${warning.code}:${warning.requested}`">
          {{ t(`settings.pages.card.companion_import.binding_warnings.${warning.code}`, { requested: warning.requested }) }}
        </li>
      </ul>
    </Callout>

    <Callout
      v-if="willReplaceExistingCard"
      :class="['sm:col-span-2']"
      theme="orange"
      :label="t('settings.pages.card.companion_import.replace_warning')"
    >
      <div :class="['flex flex-col items-start gap-2']">
        <span>{{ t('settings.pages.card.companion_import.replace_warning_description') }}</span>
        <Button
          v-if="!replacementConfirmed"
          icon="i-solar:danger-triangle-line-duotone"
          :label="t('settings.pages.card.companion_import.confirm_replace')"
          variant="secondary"
          @click="emit('confirmReplacement')"
        />
        <span v-else :class="['text-sm font-medium']">
          {{ t('settings.pages.card.companion_import.replace_confirmed') }}
        </span>
      </div>
    </Callout>

    <div :class="['flex flex-wrap gap-2 sm:col-span-2']">
      <Button
        :disabled="!canActivate"
        icon="i-solar:check-circle-line-duotone"
        :label="t('settings.pages.card.companion_import.activate')"
        @click="emit('activate')"
      />
    </div>

    <CompanionPromptPreview
      v-if="isDevelopment"
      :class="['sm:col-span-2']"
      :sections="preview.promptSections"
    />
  </div>
</template>
