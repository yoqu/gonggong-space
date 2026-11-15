<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { reducedMotion } from './motion'

// Paths from docs/brand/logo/gg-symbol.svg; the pupils sit in rings centred at (70, 95) and (186, 95).
const props = defineProps<{ size?: number; track?: boolean }>()
const BLUE =
  'M18 95A52 52 0 1 1 122 95A52 52 0 1 1 18 95ZM46 95A24 24 0 1 0 94 95A24 24 0 1 0 46 95ZM94 57A14 14 0 0 1 122 57V161A52 52 0 0 1 70 213H52A14 14 0 0 1 52 185H70A24 24 0 0 0 94 161Z'
const AMBER =
  'M134 95A52 52 0 1 1 238 95A52 52 0 1 1 134 95ZM162 95A24 24 0 1 0 210 95A24 24 0 1 0 162 95ZM210 57A14 14 0 0 1 238 57V161A52 52 0 0 1 186 213H168A14 14 0 0 1 168 185H186A24 24 0 0 0 210 161Z'
const REACH = 10

const svg = ref<SVGSVGElement>()
// The brand rest pose: both pupils glance a little down and right.
const look = ref({ x: 5, y: 4 })

const onPointer = (e: PointerEvent) => {
  const r = svg.value?.getBoundingClientRect()
  if (!r) return
  const dx = e.clientX - (r.left + r.width * 0.5)
  const dy = e.clientY - (r.top + r.height * 0.37)
  const d = Math.hypot(dx, dy)
  // Close to the face the eyes ease back toward centre instead of snapping to the rim.
  const k = (REACH * Math.min(1, d / 240)) / (d || 1)
  look.value = { x: dx * k, y: dy * k }
}
onMounted(() => {
  if (props.track && !reducedMotion()) addEventListener('pointermove', onPointer, { passive: true })
})
onBeforeUnmount(() => removeEventListener('pointermove', onPointer))
</script>

<template>
  <svg ref="svg" class="gg-mark" :width="size" :height="size" viewBox="0 0 256 256" aria-hidden="true">
    <path class="gg-mark__g" fill="#3B7BFF" :d="BLUE" />
    <path class="gg-mark__g" fill="#FFB224" :d="AMBER" />
    <g class="gg-mark__eyes" :style="{ transform: `translate(${look.x}px, ${look.y}px)` }">
      <circle class="gg-mark__pupil" cx="70" cy="95" r="11" />
      <circle class="gg-mark__pupil" cx="186" cy="95" r="11" />
    </g>
  </svg>
</template>

<style scoped>
.gg-mark {
  display: block;
  overflow: visible;
}
.gg-mark__pupil {
  fill: var(--brand-pupil);
}
.gg-mark__eyes {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.gg-mark__g {
  transform-box: fill-box;
  transform-origin: 50% 40%;
  animation: gg-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.gg-mark__g + .gg-mark__g {
  animation-delay: 0.12s;
}
.gg-mark__pupil {
  transform-box: fill-box;
  transform-origin: center;
  animation: gg-pupil 0.35s ease-out 0.55s both;
}
.gg-mark__g,
.gg-mark__pupil {
  animation-play-state: paused;
}
:global(.is-in) .gg-mark__g,
:global(.is-in) .gg-mark__pupil {
  animation-play-state: running;
}
@keyframes gg-pop {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
}
@keyframes gg-pupil {
  from {
    transform: scale(0);
  }
}
</style>
