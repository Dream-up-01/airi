<script setup lang="ts">
import { Button, Callout } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMinecraftPerceptionControl } from '../../composables/minecraftPerceptionControl'
import { useMinecraftStore } from '../../stores/modules/gaming-minecraft'

const minecraftStore = useMinecraftStore()
const perceptionControl = useMinecraftPerceptionControl()
const { t } = useI18n()

const {
  serviceConnected,
  lastRuntimeContextAt,
  runtimeContextAgeMs,
  trafficEntries,
} = storeToRefs(minecraftStore)

const statusTheme = computed(() => serviceConnected.value ? 'lime' : 'orange')

const statusLabel = computed(() => {
  return serviceConnected.value
    ? t('settings.pages.modules.gaming-minecraft.status.service-online')
    : t('settings.pages.modules.gaming-minecraft.status.service-offline')
})

const lastRuntimeUpdate = computed(() => {
  if (!lastRuntimeContextAt.value)
    return t('settings.pages.modules.gaming-minecraft.status.no-runtime-context')

  const seconds = Math.floor(runtimeContextAgeMs.value / 1000)
  if (seconds > 60)
    return t('settings.pages.modules.gaming-minecraft.status.last-context-stale')

  return t('settings.pages.modules.gaming-minecraft.status.last-context-seconds', { seconds })
})

function formatTrafficTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}

async function enablePerception() {
  if (perceptionControl)
    await perceptionControl.start(true)
  else
    minecraftStore.enablePerception()
}

async function disablePerception() {
  if (perceptionControl)
    await perceptionControl.stop()
  else
    minecraftStore.disablePerception()
}

onMounted(() => {
  minecraftStore.initialize()
})
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <Callout :theme="statusTheme" :label="statusLabel">
      <div :class="['flex flex-col gap-2 text-sm']">
        <div>
          {{ lastRuntimeUpdate }}
        </div>
      </div>
    </Callout>

    <div :class="['rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50']">
      <div :class="['mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100']">
        {{ t('settings.pages.modules.gaming-minecraft.perception.title') }}
      </div>
      <p :class="['mb-3 text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.pages.modules.gaming-minecraft.perception.description') }}
      </p>
      <div :class="['flex flex-wrap items-center gap-3']">
        <Button
          v-if="!minecraftStore.perceptionEnabled"
          :label="t('settings.pages.modules.gaming-minecraft.perception.enable')"
          variant="primary"
          @click="enablePerception"
        />
        <Button
          v-else
          :label="t('settings.pages.modules.gaming-minecraft.perception.disable')"
          @click="disablePerception"
        />
        <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.modules.gaming-minecraft.perception.counts', { accepted: minecraftStore.acceptedFactCount, rejected: minecraftStore.rejectedEventCount, suppressed: minecraftStore.suppressedEventCount }) }}
        </span>
      </div>
      <div v-if="minecraftStore.lastRejectionCode" :class="['mt-3 text-xs text-orange-700 dark:text-orange-300']">
        {{ t('settings.pages.modules.gaming-minecraft.perception.last-rejection', { code: minecraftStore.lastRejectionCode }) }}
      </div>
    </div>

    <div :class="['rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50']">
      <div :class="['mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100']">
        {{ t('settings.pages.modules.gaming-minecraft.setup.title') }}
      </div>
      <div :class="['flex flex-col gap-2 text-sm text-neutral-600 dark:text-neutral-300']">
        <p>{{ t('settings.pages.modules.gaming-minecraft.setup.description') }}</p>
        <code :class="['w-fit rounded-md bg-neutral-950/90 px-2 py-1 text-xs text-neutral-100']">services/minecraft/README.md</code>
      </div>
    </div>

    <div :class="['rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50']">
      <div :class="['mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100']">
        {{ t('settings.pages.modules.gaming-minecraft.runtime.title') }}
      </div>
      <div :class="['grid gap-3 text-sm text-neutral-600 dark:text-neutral-300']">
        <div>
          <div :class="['text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.modules.gaming-minecraft.runtime.connection') }}
          </div>
          <div>{{ statusLabel }}</div>
        </div>
        <div>{{ t('settings.pages.modules.gaming-minecraft.runtime.safe-only') }}</div>
      </div>
    </div>

    <div :class="['rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50']">
      <div :class="['mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100']">
        {{ t('settings.pages.modules.gaming-minecraft.debug.title') }}
      </div>
      <div
        v-if="trafficEntries.length === 0"
        :class="['text-sm text-neutral-500 dark:text-neutral-400']"
      >
        {{ t('settings.pages.modules.gaming-minecraft.debug.empty') }}
      </div>
      <div v-else :class="['flex flex-col gap-3']">
        <div
          v-for="entry in [...trafficEntries].reverse()"
          :key="entry.id"
          :class="['rounded-xl border border-neutral-200 bg-white/80 p-3 dark:border-neutral-800 dark:bg-black/20']"
        >
          <div :class="['flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
            <span>{{ entry.type }}</span>
            <span>{{ formatTrafficTime(entry.receivedAt) }}</span>
          </div>
          <div :class="['mt-2 text-sm font-medium text-neutral-900 dark:text-neutral-100']">
            {{ entry.summary }}
          </div>
          <div :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.modules.gaming-minecraft.debug.source', { source: entry.source }) }}
          </div>
          <div :class="['mt-2 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.modules.gaming-minecraft.debug.outcome', { outcome: entry.outcome }) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
