<script setup lang="ts">
import Cast from './Cast.vue'
import { useCopy } from './copy'
import Features from './Features.vue'
import Flow from './Flow.vue'
import Hero3D from './Hero3D.vue'
import LiveGroup from './LiveGroup.vue'
import Outro from './Outro.vue'
import Platforms from './Platforms.vue'
import Stage from './Stage.vue'
import './home.css'

const { isEn } = useCopy()
</script>

<template>
  <div class="gg" :class="{ 'gg--en': isEn }">
    <Hero3D />
    <LiveGroup />
    <Stage />
    <Flow />
    <Features />
    <Cast />
    <Platforms />
    <Outro />
  </div>
</template>
