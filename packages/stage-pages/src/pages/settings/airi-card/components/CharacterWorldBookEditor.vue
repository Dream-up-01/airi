<script setup lang="ts">
import type { CharacterBook, CharacterBookEntry } from '@proj-airi/ccc'

import { inspectCharacterBookCompatibility } from '@proj-airi/stage-ui/domains/characterBook'
import { useCharacterBookTokenizerStore } from '@proj-airi/stage-ui/stores/characterBookTokenizer'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  readonly?: boolean
}>(), {
  readonly: false,
})

const characterBook = defineModel<CharacterBook | undefined>({ required: true })
const { t } = useI18n()
const consciousnessStore = useConsciousnessStore()
const tokenizerStore = useCharacterBookTokenizerStore()
const { activeModel, activeProvider } = storeToRefs(consciousnessStore)
const { currentSnapshot: tokenizerSnapshot } = storeToRefs(tokenizerStore)

watch([activeProvider, activeModel, () => characterBook.value?.token_budget], ([providerId, modelId, tokenBudget]) => {
  if (tokenBudget !== undefined)
    void tokenizerStore.prepare(providerId, modelId)
}, { immediate: true })

const entries = computed(() => characterBook.value?.entries ?? [])
const compatibilityWarnings = computed(() => characterBook.value
  ? inspectCharacterBookCompatibility(characterBook.value)
  : [])
const tokenizerStatusKey = computed(() => `settings.pages.card.worldbook.tokenizer_${tokenizerSnapshot.value.status}`)

function createBook(): CharacterBook {
  return {
    entries: [],
    extensions: {},
  }
}

function createEntry(): CharacterBookEntry {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `entry-${entries.value.length + 1}`,
    keys: [],
    content: '',
    enabled: true,
    insertion_order: entries.value.length,
    position: 'after_char',
    priority: 0,
    extensions: {},
  }
}

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
}

function eventChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === '')
    return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function updateBook(patch: Partial<CharacterBook>): void {
  characterBook.value = {
    ...(characterBook.value ?? createBook()),
    ...patch,
  }
}

function updateEntry(index: number, patch: Partial<CharacterBookEntry>): void {
  const book = characterBook.value ?? createBook()
  const nextEntries = [...book.entries]
  nextEntries[index] = { ...nextEntries[index], ...patch }
  characterBook.value = { ...book, entries: nextEntries }
}

function addEntry(): void {
  const book = characterBook.value ?? createBook()
  characterBook.value = { ...book, entries: [...book.entries, createEntry()] }
}

function removeEntry(index: number): void {
  const book = characterBook.value
  if (!book)
    return
  characterBook.value = { ...book, entries: book.entries.filter((_, entryIndex) => entryIndex !== index) }
}

function splitKeys(value: string): string[] {
  return value.split(/\r?\n/u).map(key => key.trim()).filter(Boolean)
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="text-base text-neutral-800 font-medium dark:text-neutral-100">
          {{ t('settings.pages.card.worldbook.title') }}
        </h3>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {{ t('settings.pages.card.worldbook.description') }}
        </p>
      </div>
      <button
        v-if="!readonly"
        type="button"
        class="rounded-lg bg-primary-500 px-3 py-2 text-sm text-white transition hover:bg-primary-600"
        @click="addEntry"
      >
        {{ t('settings.pages.card.worldbook.add_entry') }}
      </button>
    </div>

    <div class="grid grid-cols-1 gap-3 rounded-xl bg-neutral-50 p-4 lg:grid-cols-2 dark:bg-neutral-900/50">
      <label class="flex flex-col gap-1 text-sm">
        <span>{{ t('settings.pages.card.worldbook.name') }}</span>
        <input
          :value="characterBook?.name ?? ''"
          :disabled="readonly"
          class="border border-neutral-200 rounded-lg bg-white px-3 py-2 outline-none dark:border-neutral-700 focus:border-primary-400 dark:bg-neutral-900"
          @input="updateBook({ name: eventValue($event) || undefined })"
        >
      </label>
      <label class="flex flex-col gap-1 text-sm">
        <span>{{ t('settings.pages.card.worldbook.scan_depth') }}</span>
        <input
          type="number"
          min="0"
          :value="characterBook?.scan_depth ?? ''"
          :disabled="readonly"
          class="border border-neutral-200 rounded-lg bg-white px-3 py-2 outline-none dark:border-neutral-700 focus:border-primary-400 dark:bg-neutral-900"
          @input="updateBook({ scan_depth: optionalNumber(eventValue($event)) })"
        >
      </label>
      <label class="flex flex-col gap-1 text-sm">
        <span>{{ t('settings.pages.card.worldbook.token_budget') }}</span>
        <input
          type="number"
          min="0"
          :value="characterBook?.token_budget ?? ''"
          :disabled="readonly"
          class="border border-neutral-200 rounded-lg bg-white px-3 py-2 outline-none dark:border-neutral-700 focus:border-primary-400 dark:bg-neutral-900"
          @input="updateBook({ token_budget: optionalNumber(eventValue($event)) })"
        >
      </label>
      <label class="flex items-center self-end gap-2 py-2 text-sm">
        <input
          type="checkbox"
          :checked="characterBook?.recursive_scanning ?? false"
          :disabled="readonly"
          @change="updateBook({ recursive_scanning: eventChecked($event) })"
        >
        <span>{{ t('settings.pages.card.worldbook.recursive_scanning') }}</span>
      </label>
      <label class="flex flex-col gap-1 text-sm lg:col-span-2">
        <span>{{ t('settings.pages.card.worldbook.book_description') }}</span>
        <textarea
          :value="characterBook?.description ?? ''"
          :disabled="readonly"
          rows="2"
          class="resize-y border border-neutral-200 rounded-lg bg-white px-3 py-2 outline-none dark:border-neutral-700 focus:border-primary-400 dark:bg-neutral-900"
          @input="updateBook({ description: eventValue($event) || undefined })"
        />
      </label>
      <p v-if="characterBook?.token_budget !== undefined" class="text-xs text-amber-600 lg:col-span-2 dark:text-amber-400">
        {{ t(tokenizerStatusKey) }}
      </p>
      <ul v-if="compatibilityWarnings.length" class="flex flex-col list-disc gap-1 pl-5 text-xs text-amber-600 lg:col-span-2 dark:text-amber-400">
        <li v-for="(warning, index) in compatibilityWarnings" :key="`${warning.code}:${index}`">
          {{ t(`settings.pages.card.worldbook.warnings.${warning.code}`) }}
        </li>
      </ul>
    </div>

    <div v-if="entries.length === 0" class="border border-neutral-300 rounded-xl border-dashed p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
      {{ t('settings.pages.card.worldbook.empty') }}
    </div>

    <article
      v-for="(entry, index) in entries"
      :key="String(entry.id ?? index)"
      class="flex flex-col gap-4 border border-neutral-200 rounded-xl p-4 dark:border-neutral-700"
    >
      <div class="flex items-center justify-between gap-3">
        <h4 class="font-medium">
          {{ entry.name || entry.comment || t('settings.pages.card.worldbook.entry_number', { number: index + 1 }) }}
        </h4>
        <button
          v-if="!readonly"
          type="button"
          class="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          @click="removeEntry(index)"
        >
          {{ t('settings.pages.card.worldbook.remove_entry') }}
        </button>
      </div>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('settings.pages.card.worldbook.entry_name') }}</span>
          <input
            :value="entry.name ?? ''"
            :disabled="readonly"
            class="border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
            @input="updateEntry(index, { name: eventValue($event) || undefined })"
          >
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('settings.pages.card.worldbook.comment') }}</span>
          <input
            :value="entry.comment ?? ''"
            :disabled="readonly"
            class="border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
            @input="updateEntry(index, { comment: eventValue($event) || undefined })"
          >
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('settings.pages.card.worldbook.keys') }}</span>
          <textarea
            :value="entry.keys.join('\n')"
            :disabled="readonly"
            rows="3"
            class="resize-y border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
            @input="updateEntry(index, { keys: splitKeys(eventValue($event)) })"
          />
          <span class="text-xs text-neutral-500">{{ t('settings.pages.card.worldbook.keys_hint') }}</span>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('settings.pages.card.worldbook.secondary_keys') }}</span>
          <textarea
            :value="(entry.secondary_keys ?? []).join('\n')"
            :disabled="readonly"
            rows="3"
            class="resize-y border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
            @input="updateEntry(index, { secondary_keys: splitKeys(eventValue($event)) })"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm lg:col-span-2">
          <span>{{ t('settings.pages.card.worldbook.content') }}</span>
          <textarea
            :value="entry.content"
            :disabled="readonly"
            rows="5"
            class="resize-y border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
            @input="updateEntry(index, { content: eventValue($event) })"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('settings.pages.card.worldbook.position') }}</span>
          <select
            :value="entry.position ?? 'after_char'"
            :disabled="readonly"
            class="border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
            @change="updateEntry(index, { position: eventValue($event) as CharacterBookEntry['position'] })"
          >
            <option value="before_char">{{ t('settings.pages.card.worldbook.before_character') }}</option>
            <option value="after_char">{{ t('settings.pages.card.worldbook.after_character') }}</option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1 text-sm">
            <span>{{ t('settings.pages.card.worldbook.priority') }}</span>
            <input
              type="number"
              :value="entry.priority ?? ''"
              :disabled="readonly"
              class="border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
              @input="updateEntry(index, { priority: optionalNumber(eventValue($event)) })"
            >
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span>{{ t('settings.pages.card.worldbook.insertion_order') }}</span>
            <input
              type="number"
              :value="entry.insertion_order"
              :disabled="readonly"
              class="border border-neutral-200 rounded-lg bg-transparent px-3 py-2 dark:border-neutral-700"
              @input="updateEntry(index, { insertion_order: optionalNumber(eventValue($event)) ?? 0 })"
            >
          </label>
        </div>
      </div>

      <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label
          v-for="toggle in ([
            ['enabled', 'enabled'],
            ['constant', 'constant'],
            ['use_regex', 'use_regex'],
            ['selective', 'selective'],
            ['case_sensitive', 'case_sensitive'],
          ] as const)" :key="toggle[0]" class="flex items-center gap-2"
        >
          <input
            type="checkbox"
            :checked="Boolean(entry[toggle[0]])"
            :disabled="readonly"
            @change="updateEntry(index, { [toggle[0]]: eventChecked($event) })"
          >
          <span>{{ t(`settings.pages.card.worldbook.${toggle[1]}`) }}</span>
        </label>
      </div>
    </article>
  </section>
</template>
