<script setup lang="ts">
import { useCharacterSourceImportStore } from '@proj-airi/stage-ui/stores/characterSourceImport'
import { storeToRefs } from 'pinia'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CharacterAnalysisProgress from './CharacterAnalysisProgress.vue'
import CharacterCandidateSelector from './CharacterCandidateSelector.vue'
import CharacterConflictReview from './CharacterConflictReview.vue'
import CharacterDraftEditor from './CharacterDraftEditor.vue'
import CharacterDraftSummary from './CharacterDraftSummary.vue'
import CharacterSourcePicker from './CharacterSourcePicker.vue'

const emit = defineEmits<{ (e: 'created', cardId: string): void }>()
const modelValue = defineModel<boolean>({ default: false })
const { t, te } = useI18n()
const importStore = useCharacterSourceImportStore()
const { step, errorCode, editableDraft, extractionJob, extractionCandidates, extractionCandidateEvidence } = storeToRefs(importStore)
const localizedError = computed(() => {
  const key = `settings.pages.card.character_source_import.errors.${errorCode.value ?? 'unknown'}`
  return te(key) ? t(key) : t('settings.pages.card.character_source_import.errors.unknown')
})

function handleOpen(open: boolean) {
  if (!open)
    importStore.cancelImport()
  modelValue.value = open
}

function handleCreated(cardId: string) {
  emit('created', cardId)
  modelValue.value = false
  importStore.cancelImport()
}

watch(modelValue, (open) => {
  if (open)
    importStore.open()
})
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="handleOpen">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-100 bg-black/50 data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-100 max-h-[90dvh] max-w-2xl w-full overflow-y-auto border border-neutral-200 rounded-2xl bg-white shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-900"
        @interact-outside.prevent
      >
        <DialogTitle class="sr-only">
          {{ t('settings.pages.card.character_source_import.title') }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ t('settings.pages.card.character_source_import.entry_description') }}
        </DialogDescription>
        <!-- Picker step -->
        <CharacterSourcePicker
          v-if="step === 'picking'"
          @cancel="handleOpen(false)"
          @start="(params) => importStore.startFromDocument(params)"
        />

        <!-- Extraction running -->
        <CharacterAnalysisProgress
          v-else-if="step === 'extracting'"
          :job="extractionJob"
          @cancel="importStore.cancelImport(); handleOpen(false)"
        >
          <!-- Multi-candidate overlay when awaiting selection -->
          <CharacterCandidateSelector
            v-if="extractionJob?.state === 'awaiting-character-selection'"
            :candidates="extractionCandidates"
            :evidence-by-candidate="extractionCandidateEvidence"
            @select="(id) => importStore.selectCandidate(id)"
          />
        </CharacterAnalysisProgress>

        <!-- Draft review -->
        <div v-else-if="step === 'reviewing' && editableDraft">
          <CharacterConflictReview
            v-if="editableDraft.conflicts.some(c => c.status === 'unresolved')"
            :conflicts="editableDraft.conflicts"
            :facts="editableDraft.facts"
            @resolve="(id, dec) => importStore.resolveConflict(id, dec)"
          />
          <CharacterDraftEditor
            :draft="editableDraft"
            @update:draft="importStore.updateDraftField"
            @confirm-fact="(id) => importStore.confirmFacts([id])"
            @confirm-value="(f, i) => importStore.confirmDraftValue(f, i)"
            @replace-lore="importStore.replaceLoreEntries"
            @proceed="importStore.proceedToConfirm()"
            @cancel="importStore.cancelImport(); handleOpen(false)"
          />
        </div>

        <!-- Final summary -->
        <CharacterDraftSummary
          v-else-if="step === 'confirming' && editableDraft"
          :draft="editableDraft"
          @back="importStore.backToReview()"
          @confirm="() => { const id = importStore.confirmAndCreateCard(); if (id) handleCreated(id) }"
        />

        <!-- Error state -->
        <div v-else-if="step === 'error'" :class="['flex flex-col gap-4 p-6']">
          <p class="text-red-600 font-medium dark:text-red-400">
            {{ t('settings.pages.card.character_source_import.error') }}
          </p>
          <p class="text-sm text-neutral-500">
            {{ localizedError }}
          </p>
          <button
            :class="['mt-2 rounded-lg bg-neutral-100 px-4 py-2 text-sm dark:bg-neutral-800']"
            @click="handleOpen(false)"
          >
            {{ t('settings.pages.card.cancel') }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
