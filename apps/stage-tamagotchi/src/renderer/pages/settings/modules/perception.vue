<script setup lang="ts">
import PerceptionControlSurface from '../../../components/perception/PerceptionControlSurface.vue'
</script>

<template>
  <div mx-auto max-w-2xl flex justify-center>
    <PerceptionControlSurface />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.perception.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.modules.perception.description
  icon: i-solar:monitor-camera-outline
  settingsEntry: true
  order: 2.5
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
