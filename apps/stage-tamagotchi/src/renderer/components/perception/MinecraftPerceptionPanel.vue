<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import LocalScreenPerceptionFacts from './LocalScreenPerceptionFacts.vue'
import MinecraftPairingPanel from './MinecraftPairingPanel.vue'

import { useMinecraftPerception } from '../../composables/perception/use-minecraft-perception'

const perception = useMinecraftPerception()
const minecraftStore = perception.store
const { t } = useI18n()
const consentConfirmed = shallowRef(false)
const state = perception.state
const errorCode = computed(() => perception.lastControlErrorCode.value ?? minecraftStore.lastRejectionCode)

const lastRuntimeUpdate = computed(() => {
  if (!minecraftStore.configured)
    return t('tamagotchi.stage.perception-minecraft.no-runtime-context')

  const seconds = Math.floor(minecraftStore.runtimeContextAgeMs / 1_000)
  if (seconds > 60)
    return t('tamagotchi.stage.perception-minecraft.runtime-context-stale')
  return t('tamagotchi.stage.perception-minecraft.runtime-context-age', { seconds })
})

watch(() => minecraftStore.perceptionEnabled, (enabled) => {
  if (!enabled)
    consentConfirmed.value = false
})

function enablePerception(): void {
  if (!consentConfirmed.value)
    return
  void perception.start(consentConfirmed.value)
}
</script>

<template>
  <section class="max-h-[calc(100vh-5rem)] w-[min(28rem,calc(100vw-1rem))] overflow-y-auto border border-neutral-200 rounded-2xl bg-white/95 p-4 text-neutral-800 shadow-2xl backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100">
    <header flex items-start gap-3>
      <div mt-0.5 size-8 flex shrink-0 items-center justify-center rounded-xl bg-lime-500:15 text-lime-700 dark:text-lime-300>
        <div i-solar:gamepad-outline size-5 />
      </div>
      <div min-w-0>
        <h2 text-base font-semibold>
          {{ t('tamagotchi.stage.perception-minecraft.title') }}
        </h2>
        <p mt-1 text-xs text-neutral-600 dark:text-neutral-300>
          {{ t('tamagotchi.stage.perception-minecraft.description') }}
        </p>
      </div>
    </header>

    <div mt-4 rounded-xl bg-lime-500:8 p-3 text-xs text-lime-900 dark:text-lime-200>
      {{ t('tamagotchi.stage.perception-minecraft.privacy-notice') }}
    </div>

    <div v-if="perception.hasRemoteOwner.value" mt-3 rounded-xl bg-amber-500:10 p-3 text-xs text-amber-800 dark:text-amber-200>
      {{ t('tamagotchi.stage.perception-runtime.remote-read-only', { sources: perception.remoteStatuses.value.map(status => t(`tamagotchi.stage.perception-runtime.source.${status.sourceKind}`)).join(', ') }) }}
    </div>

    <div grid mt-4 gap-2 text-xs>
      <div flex items-center gap-2 rounded-xl bg-neutral-500:7 px-3 py-2>
        <span size-2 rounded-full :class="minecraftStore.serviceConnected ? 'bg-lime-500' : 'bg-neutral-400'" />
        <span font-medium>{{ t('tamagotchi.stage.perception-minecraft.runtime') }}</span>
        <span ml-auto>{{ t(`tamagotchi.stage.perception-minecraft.state.${state}`) }}</span>
      </div>
      <div flex items-center justify-between gap-3 rounded-xl bg-neutral-500:7 px-3 py-2>
        <span>{{ t('tamagotchi.stage.perception-minecraft.processing') }}</span>
        <span font-medium>{{ t('tamagotchi.stage.perception-minecraft.local-structured') }}</span>
      </div>
      <div rounded-xl bg-neutral-500:7 px-3 py-2>
        {{ lastRuntimeUpdate }}
      </div>
      <div rounded-xl bg-neutral-500:7 px-3 py-2>
        {{ t('tamagotchi.stage.perception-minecraft.counts', {
          accepted: minecraftStore.acceptedFactCount,
          rejected: minecraftStore.rejectedEventCount,
          suppressed: minecraftStore.suppressedEventCount,
        }) }}
      </div>
    </div>

    <p v-if="errorCode" mt-3 rounded-lg bg-amber-500:10 p-2 text-xs text-amber-800 dark:text-amber-200>
      {{ t('tamagotchi.stage.perception-minecraft.last-rejection', { code: errorCode }) }}
    </p>

    <p v-if="state === 'waiting'" mt-3 rounded-lg bg-amber-500:10 p-2 text-xs text-amber-800 dark:text-amber-200>
      {{ t('tamagotchi.stage.perception-minecraft.waiting-help') }}
    </p>

    <label v-if="!minecraftStore.perceptionEnabled" mt-4 flex items-start gap-2 text-xs :class="perception.hasRemoteOwner.value ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
      <input v-model="consentConfirmed" type="checkbox" mt-0.5 :disabled="perception.hasRemoteOwner.value">
      <span>{{ t('tamagotchi.stage.perception-minecraft.consent') }}</span>
    </label>

    <LocalScreenPerceptionFacts
      v-if="minecraftStore.perceptionObservability"
      :snapshot="minecraftStore.perceptionObservability"
      @confirm="minecraftStore.confirmFact"
      @retract="minecraftStore.retractFact"
      @clear="minecraftStore.clearFacts"
    />

    <MinecraftPairingPanel />

    <div mt-4 flex flex-wrap justify-end gap-2>
      <button
        v-if="minecraftStore.perceptionEnabled && !minecraftStore.perceptionPaused"
        type="button"
        border border-amber-400 rounded-xl px-3 py-2 text-sm text-amber-700 dark:text-amber-300
        @click="perception.pause"
      >
        {{ t('tamagotchi.stage.perception-minecraft.pause') }}
      </button>
      <button
        v-if="minecraftStore.perceptionEnabled && minecraftStore.perceptionPaused"
        type="button"
        rounded-xl bg-lime-600 px-3 py-2 text-sm text-white
        @click="perception.resume"
      >
        {{ t('tamagotchi.stage.perception-minecraft.resume') }}
      </button>
      <button
        v-if="minecraftStore.perceptionEnabled"
        type="button"
        border border-red-400 rounded-xl px-3 py-2 text-sm text-red-700 dark:text-red-300
        @click="perception.stop"
      >
        {{ t('tamagotchi.stage.perception-minecraft.stop') }}
      </button>
      <button
        v-else
        type="button"
        rounded-xl bg-lime-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40
        :disabled="!consentConfirmed || perception.hasRemoteOwner.value"
        @click="enablePerception"
      >
        {{ t('tamagotchi.stage.perception-minecraft.start') }}
      </button>
    </div>
  </section>
</template>
