<script setup lang="ts">
import type { PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'

import { useTimestamp } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

defineProps<{
  snapshot: PerceptionObservabilitySnapshot
}>()

const emit = defineEmits<{
  confirm: [factId: string]
  retract: [factId: string]
  clear: []
}>()

const { t } = useI18n()
const now = useTimestamp({ interval: 1_000 })

function secondsSince(timestamp: number): number {
  return Math.max(0, Math.floor((now.value - timestamp) / 1_000))
}

function secondsUntil(timestamp: number): number {
  return Math.max(0, Math.ceil((timestamp - now.value) / 1_000))
}

function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100)
}
</script>

<template>
  <section mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-700>
    <div flex items-center gap-2>
      <h3 text-xs font-semibold>
        {{ t('tamagotchi.stage.perception-screen.facts-title') }}
      </h3>
      <span class="text-[11px]" ml-auto opacity-65>
        {{ t('tamagotchi.stage.perception-screen.fact-counts', {
          accepted: snapshot.counts.accepted,
          suppressed: snapshot.counts.suppressed,
          revoked: snapshot.counts.revoked + snapshot.counts.expired,
        }) }}
      </span>
    </div>

    <div v-if="snapshot.sourceHealth.length > 0" mt-2 flex flex-wrap gap-1.5>
      <span
        v-for="health in snapshot.sourceHealth"
        :key="`${health.sourceKind}:${health.sourceId}`"
        class="text-[11px]"
        rounded-full bg-neutral-500:10 px-2 py-0.5
      >
        {{ health.sourceKind }} · {{ health.status }}
      </span>
    </div>

    <p v-if="snapshot.facts.length === 0" mt-2 text-xs opacity-65>
      {{ t('tamagotchi.stage.perception-screen.no-facts') }}
    </p>

    <ul v-else mt-2 flex flex-col gap-2>
      <li
        v-for="fact in snapshot.facts"
        :key="fact.factId"
        rounded-xl bg-neutral-500:7 p-2.5 text-xs
      >
        <div flex items-start gap-2>
          <div min-w-0 flex-1>
            <div flex flex-wrap items-center gap-1.5>
              <code font-semibold>{{ fact.category }}.{{ fact.predicate }}</code>
              <span class="text-[10px]" rounded-full bg-neutral-500:10 px-1.5 py-0.5>{{ fact.state }}</span>
              <span v-if="fact.verification === 'user-confirmed'" class="text-[10px]" rounded-full bg-emerald-500:12 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300>
                {{ t('tamagotchi.stage.perception-screen.user-confirmed') }}
              </span>
            </div>
            <p mt-1 break-words>
              <span v-if="fact.safeValue !== undefined"><code>{{ String(fact.safeValue) }}</code></span>
              <span v-else opacity-65>{{ t('tamagotchi.stage.perception-screen.value-redacted') }}</span>
            </p>
            <p class="text-[11px]" mt-1 opacity-65>
              {{ t('tamagotchi.stage.perception-screen.fact-metadata', {
                confidence: confidencePercent(fact.confidence),
                age: secondsSince(fact.observedAt),
                ttl: secondsUntil(fact.expiresAt),
                source: fact.sourceKind,
                processing: fact.processing,
              }) }}
            </p>
            <p v-if="fact.suppressionReason" class="text-[11px]" mt-1 text-amber-700 dark:text-amber-300>
              {{ t('tamagotchi.stage.perception-screen.suppression-reason', { reason: fact.suppressionReason }) }}
            </p>
          </div>
        </div>

        <div v-if="fact.state === 'accepted'" mt-2 flex gap-2>
          <button
            type="button"
            class="text-[11px]"
            border border-emerald-400 rounded-lg px-2 py-1 text-emerald-700 disabled:cursor-not-allowed dark:text-emerald-300 disabled:opacity-40
            :disabled="fact.verification === 'user-confirmed'"
            @click="emit('confirm', fact.factId)"
          >
            {{ t('tamagotchi.stage.perception-screen.confirm-fact') }}
          </button>
          <button
            type="button"
            class="text-[11px]"
            border border-amber-400 rounded-lg px-2 py-1 text-amber-700 dark:text-amber-300
            @click="emit('retract', fact.factId)"
          >
            {{ t('tamagotchi.stage.perception-screen.correct-fact') }}
          </button>
        </div>
      </li>
    </ul>

    <button
      v-if="snapshot.facts.length > 0"
      type="button"
      class="text-[11px]"
      mt-3 border border-neutral-300 rounded-lg px-2.5 py-1 dark:border-neutral-700
      @click="emit('clear')"
    >
      {{ t('tamagotchi.stage.perception-screen.clear-facts') }}
    </button>
  </section>
</template>
