<script setup lang="ts">
import type { CharacterBook } from '@proj-airi/ccc'
import type { CharacterDraft, CharacterDraftLoreEntry, GroundedCharacterValue } from '@proj-airi/stage-ui/domains/characterSource'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CharacterWorldBookEditor from '../CharacterWorldBookEditor.vue'
import CharacterEvidencePanel from './CharacterEvidencePanel.vue'

const props = defineProps<{ draft: CharacterDraft }>()
const emit = defineEmits<{
  'cancel': []
  'confirmFact': [factId: string]
  'confirmValue': [field: 'description' | 'greetings' | 'messageExamples' | 'name' | 'personality' | 'relationships' | 'scenario' | 'story', index: number | null]
  'proceed': []
  'replaceLore': [entries: CharacterDraftLoreEntry[]]
  'update:draft': [key: keyof CharacterDraft, value: CharacterDraft[keyof CharacterDraft]]
}>()

const { t } = useI18n()
const hasBlockingConflicts = computed(() => props.draft.conflicts.some(conflict => conflict.status === 'unresolved'))

function updateGrounded(field: 'description' | 'name' | 'scenario', value: string): void {
  const current = props.draft[field]
  emit('update:draft', field, current
    ? value === current.value
      ? current
      : { ...current, value, userConfirmed: true, origin: 'user', sourceFactIds: [], evidenceBlockIds: [], quote: '' }
    : {
        value,
        supportStatus: 'explicit',
        evidenceBlockIds: [],
        quote: '',
        evidenceValidation: 'verified',
        userConfirmed: true,
        origin: 'user',
        sourceFactIds: [],
      })
}

type ListDraftField = 'greetings' | 'messageExamples' | 'personality' | 'relationships' | 'story'

function listValues(field: ListDraftField): GroundedCharacterValue<string>[] {
  return props.draft[field]
}

function updateGroundedList(field: ListDraftField, text: string): void {
  const current = props.draft[field]
  const values = text.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
  const nextValues: GroundedCharacterValue<string>[] = values.map((value, index) => current[index]
    ? value === current[index]!.value
      ? current[index]!
      : { ...current[index]!, value, userConfirmed: true, origin: 'user' as const, sourceFactIds: [], evidenceBlockIds: [], quote: '' }
    : {
        value,
        supportStatus: 'explicit' as const,
        evidenceBlockIds: [],
        quote: '',
        evidenceValidation: 'verified' as const,
        userConfirmed: true,
        origin: 'user' as const,
        sourceFactIds: [],
      })
  emit('update:draft', field, nextValues)
}

function updateStyle(key: keyof CharacterDraft['languageStyle'], value: string): void {
  emit('update:draft', 'languageStyle', {
    ...props.draft.languageStyle,
    [key]: value.split(/[、,\n]/u).map(item => item.trim()).filter(Boolean),
  })
}

function existingLoreEntry(id: number | string | undefined): CharacterDraftLoreEntry | undefined {
  return props.draft.loreEntries.find(entry => entry.draftEntryId === String(id))
}

function loreEntrySourceFactIds(entry: CharacterBook['entries'][number], sourceIndex: number): string[] {
  const existing = existingLoreEntry(entry.id)
  if (!existing)
    return []
  const reviewedShape = {
    name: existing.name,
    content: existing.content,
    keys: existing.keys,
    secondaryKeys: existing.secondaryKeys ?? [],
    selective: existing.selective ?? false,
    useRegex: existing.useRegex ?? false,
    caseSensitive: existing.caseSensitive ?? false,
    constant: existing.constant ?? false,
    priority: existing.priority,
    insertionOrder: existing.insertionOrder ?? sourceIndex,
    position: existing.position ?? 'after_char',
  }
  const editedShape = {
    name: entry.name,
    content: entry.content,
    keys: entry.keys,
    secondaryKeys: entry.secondary_keys ?? [],
    selective: entry.selective ?? false,
    useRegex: entry.use_regex ?? false,
    caseSensitive: entry.case_sensitive ?? false,
    constant: entry.constant ?? false,
    priority: entry.priority,
    insertionOrder: entry.insertion_order,
    position: entry.position ?? 'after_char',
  }
  return JSON.stringify(reviewedShape) === JSON.stringify(editedShape) ? existing.sourceFactIds : []
}

const characterBook = computed<CharacterBook>({
  get: () => ({
    name: props.draft.loreBook.name,
    description: props.draft.loreBook.description,
    scan_depth: props.draft.loreBook.scanDepth,
    token_budget: props.draft.loreBook.tokenBudget,
    recursive_scanning: props.draft.loreBook.recursiveScanning,
    entries: props.draft.loreEntries.map((entry, sourceIndex) => ({
      id: entry.draftEntryId,
      name: entry.name,
      keys: entry.keys,
      secondary_keys: entry.secondaryKeys,
      content: entry.content,
      enabled: true,
      insertion_order: entry.insertionOrder ?? sourceIndex,
      position: entry.position ?? 'after_char',
      priority: entry.priority,
      constant: entry.constant ?? false,
      selective: entry.selective,
      use_regex: entry.useRegex,
      case_sensitive: entry.caseSensitive,
      extensions: {},
    })),
    extensions: {},
  }),
  set: (book) => {
    emit('update:draft', 'loreBook', {
      name: book.name,
      description: book.description,
      scanDepth: book.scan_depth,
      tokenBudget: book.token_budget,
      recursiveScanning: book.recursive_scanning,
    })
    emit('replaceLore', book.entries.map((entry, sourceIndex) => ({
      draftEntryId: String(entry.id ?? `lore:user:${sourceIndex + 1}`),
      name: entry.name,
      content: entry.content,
      keys: entry.keys,
      secondaryKeys: entry.secondary_keys,
      selective: entry.selective,
      useRegex: entry.use_regex,
      caseSensitive: entry.case_sensitive,
      constant: entry.constant ?? false,
      priority: entry.priority,
      insertionOrder: entry.insertion_order,
      position: entry.position,
      sourceFactIds: loreEntrySourceFactIds(entry, sourceIndex),
    })))
  },
})

const inferredLoreFacts = computed(() => {
  const loreFactIds = new Set(props.draft.loreEntries.flatMap(entry => entry.sourceFactIds))
  const confirmedFactIds = new Set(props.draft.confirmedFactIds)
  return props.draft.facts.filter(fact => loreFactIds.has(fact.factId)
    && fact.supportStatus === 'inferred'
    && fact.evidenceValidation === 'verified'
    && !confirmedFactIds.has(fact.factId))
})

const styleFields: Array<{ key: keyof CharacterDraft['languageStyle'], label: string }> = [
  { key: 'tone', label: t('settings.pages.card.character_source_import.style.tone') },
  { key: 'addressTerms', label: t('settings.pages.card.character_source_import.style.address_terms') },
  { key: 'pronouns', label: t('settings.pages.card.character_source_import.style.pronouns') },
  { key: 'sentencePatterns', label: t('settings.pages.card.character_source_import.style.sentence_patterns') },
  { key: 'vocabulary', label: t('settings.pages.card.character_source_import.style.vocabulary') },
  { key: 'catchphrases', label: t('settings.pages.card.character_source_import.style.catchphrases') },
  { key: 'emotionalExpression', label: t('settings.pages.card.character_source_import.style.emotional_expression') },
  { key: 'prohibitedExpressions', label: t('settings.pages.card.character_source_import.style.prohibited_expressions') },
]

const listFields: Array<{ key: ListDraftField, label: string }> = [
  { key: 'personality', label: t('settings.pages.card.personality') },
  { key: 'story', label: t('settings.pages.card.character_source_import.story') },
  { key: 'relationships', label: t('settings.pages.card.character_source_import.relationships') },
  { key: 'greetings', label: t('settings.pages.card.character_source_import.greetings') },
  { key: 'messageExamples', label: t('settings.pages.card.character_source_import.message_examples') },
]

function needsConfirmation(value: GroundedCharacterValue<string>): boolean {
  return value.supportStatus === 'inferred' && !value.userConfirmed
}
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <h2 class="text-xl font-medium">
      {{ t('settings.pages.card.character_source_import.review_title') }}
    </h2>

    <div v-if="hasBlockingConflicts" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
      {{ t('settings.pages.card.character_source_import.unresolved_conflicts') }}
    </div>
    <div v-if="!draft.name?.value.trim()" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
      {{ t('settings.pages.card.character_source_import.name_required') }}
    </div>

    <section v-for="field in (['name', 'description', 'scenario'] as const)" :key="field" class="flex flex-col gap-2">
      <label class="text-sm text-neutral-600 font-medium dark:text-neutral-300">{{ t(`settings.pages.card.${field}`) }}</label>
      <textarea
        :value="draft[field]?.value ?? ''"
        :rows="field === 'name' ? 1 : 3"
        class="border border-neutral-200 rounded-lg bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        @input="updateGrounded(field, ($event.target as HTMLTextAreaElement).value)"
      />
      <button
        v-if="draft[field] && needsConfirmation(draft[field]!)"
        class="self-start text-xs text-amber-600 hover:underline"
        @click="emit('confirmValue', field, null)"
      >
        {{ t('settings.pages.card.character_source_import.confirm_inferred') }}
      </button>
      <CharacterEvidencePanel v-if="draft[field] && draft[field]!.origin !== 'user'" :value="draft[field]!" />
    </section>

    <section v-for="field in listFields" :key="field.key" class="flex flex-col gap-3">
      <label class="text-sm text-neutral-600 font-medium dark:text-neutral-300">{{ field.label }}</label>
      <textarea
        :value="listValues(field.key).map(value => value.value).join('\n')"
        rows="4"
        class="border border-neutral-200 rounded-lg bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        @input="updateGroundedList(field.key, ($event.target as HTMLTextAreaElement).value)"
      />
      <div v-for="(value, index) in listValues(field.key)" :key="value.sourceFactIds?.[0] ?? `${field.key}:${index}`" class="flex flex-col gap-2">
        <button v-if="needsConfirmation(value)" class="self-start text-xs text-amber-600 hover:underline" @click="emit('confirmValue', field.key, index)">
          {{ t('settings.pages.card.character_source_import.confirm_inferred') }}
        </button>
        <CharacterEvidencePanel v-if="value.origin !== 'user'" :value="value" />
      </div>
    </section>

    <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label v-for="field in styleFields" :key="field.key" class="flex flex-col gap-1 text-sm">
        <span>{{ field.label }}</span>
        <textarea
          :value="draft.languageStyle[field.key].join('、')"
          rows="2"
          class="border border-neutral-200 rounded-lg bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
          @input="updateStyle(field.key, ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
    </section>

    <CharacterWorldBookEditor v-model="characterBook" />

    <section v-if="inferredLoreFacts.length" class="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
      <h3 class="text-sm text-amber-800 font-medium dark:text-amber-300">
        {{ t('settings.pages.card.character_source_import.inferred_lore_title') }}
      </h3>
      <div v-for="fact in inferredLoreFacts" :key="fact.factId" class="flex items-start justify-between gap-3 text-sm">
        <span class="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{{ fact.value }}</span>
        <button class="shrink-0 text-xs text-amber-700 dark:text-amber-300 hover:underline" @click="emit('confirmFact', fact.factId)">
          {{ t('settings.pages.card.character_source_import.confirm_inferred') }}
        </button>
      </div>
    </section>

    <div class="flex justify-end gap-3">
      <button class="rounded-lg px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700" @click="emit('cancel')">
        {{ t('settings.pages.card.cancel') }}
      </button>
      <button
        class="rounded-lg bg-primary-500 px-4 py-2 text-sm text-white font-medium disabled:cursor-not-allowed hover:bg-primary-600 disabled:opacity-40"
        :disabled="hasBlockingConflicts || !draft.name?.value.trim()"
        @click="emit('proceed')"
      >
        {{ t('settings.pages.card.character_source_import.proceed_to_confirm') }}
      </button>
    </div>
  </div>
</template>
