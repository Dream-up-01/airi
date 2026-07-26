<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useMinecraftPairing } from '../../composables/perception/use-minecraft-pairing'

const pairing = useMinecraftPairing()
const { t } = useI18n()
</script>

<template>
  <div mt-4 border-t border-neutral-200 pt-3 text-xs dark:border-neutral-700>
    <div flex items-center justify-between gap-2>
      <div font-medium>
        {{ t('tamagotchi.stage.perception-minecraft.pairing.title') }}
      </div>
      <button type="button" border border-neutral-300 rounded-lg px-2 py-1 dark:border-neutral-600 @click="pairing.refresh">
        {{ t('tamagotchi.stage.perception-minecraft.pairing.refresh') }}
      </button>
    </div>

    <div v-if="pairing.requests.value.length" grid mt-2 gap-2>
      <div v-for="request in pairing.requests.value" :key="request.requestId" rounded-lg bg-amber-500:10 p-2>
        <div font-medium>
          {{ request.displayName }}
        </div>
        <div mt-1 text-neutral-600 dark:text-neutral-300>
          {{ t('tamagotchi.stage.perception-minecraft.pairing.request', { code: request.verificationCode }) }}
        </div>
        <div mt-2 flex gap-2>
          <button type="button" rounded-lg bg-lime-600 px-2 py-1 text-white @click="pairing.approve(request.requestId)">
            {{ t('tamagotchi.stage.perception-minecraft.pairing.approve') }}
          </button>
          <button type="button" border border-red-300 rounded-lg px-2 py-1 text-red-700 dark:text-red-300 @click="pairing.reject(request.requestId)">
            {{ t('tamagotchi.stage.perception-minecraft.pairing.reject') }}
          </button>
        </div>
      </div>
    </div>
    <p v-else mt-2 text-neutral-500>
      {{ t('tamagotchi.stage.perception-minecraft.pairing.empty') }}
    </p>

    <div v-if="pairing.devices.value.length" grid mt-3 gap-1>
      <div v-for="device in pairing.devices.value" :key="device.deviceId" flex items-center justify-between gap-2 rounded-lg bg-neutral-500:7 px-2 py-1.5>
        <span min-w-0 truncate>{{ device.displayName }} · {{ device.fingerprint }}</span>
        <button type="button" border border-red-300 rounded-lg px-2 py-1 text-red-700 dark:text-red-300 @click="pairing.revoke(device.deviceId)">
          {{ t('tamagotchi.stage.perception-minecraft.pairing.revoke') }}
        </button>
      </div>
    </div>

    <p v-if="pairing.error.value" mt-2 text-red-700 dark:text-red-300>
      {{ t('tamagotchi.stage.perception-minecraft.pairing.error') }}
    </p>
  </div>
</template>
