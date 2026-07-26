<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import PerceptionControlSurface from '../../perception/PerceptionControlSurface.vue'
import ControlButton from './control-button.vue'

import { useLocalCameraPerception } from '../../../composables/perception/use-local-camera-perception'
import { useLocalScreenPerception } from '../../../composables/perception/use-local-screen-perception'

defineProps<{
  open: boolean
  buttonStyle: string
  iconClass: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const perception = useLocalScreenPerception()
const cameraPerception = useLocalCameraPerception()
const { t } = useI18n()
</script>

<template>
  <div>
    <ControlButton
      :aria-label="t('tamagotchi.stage.perception-screen.title')"
      :button-style="buttonStyle"
      @click="emit('update:open', !open)"
    >
      <div
        i-solar:monitor-camera-outline
        :class="[iconClass, perception.isCollecting.value || cameraPerception.isCollecting.value ? 'text-cyan-500' : 'text-neutral-800 dark:text-neutral-300']"
      />
    </ControlButton>

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        leave-active-class="transition duration-150"
        enter-from-class="opacity-0 translate-y-2"
        leave-to-class="opacity-0 translate-y-2"
      >
        <div v-if="open" fixed bottom-18 right-2 z-110>
          <PerceptionControlSurface @started="emit('update:open', false)" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
