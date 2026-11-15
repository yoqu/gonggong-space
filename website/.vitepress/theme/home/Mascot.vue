<script setup lang="ts">
// Port of apps/web/src/ui/mascot.tsx (full-body 共字君 only); it shares that component's stylesheet.
import '../../../../apps/web/src/ui/mascot.css'

withDefaults(defineProps<{ action?: string; size?: number }>(), { action: 'idle', size: 120 })

const INK = 'var(--brand-ink)'
const EYES = [55.5, 64.5]
const CONFETTI: [number, number, string][] = [
  [-34, -26, 'var(--system-blue)'],
  [30, -34, 'var(--system-teal)'],
  [-42, 6, 'var(--system-orange)'],
  [42, -4, 'var(--system-green)'],
  [-16, -42, 'var(--system-pink, #FF8FB1)'],
  [18, -46, 'var(--system-blue)'],
  [44, 22, 'var(--system-orange)'],
  [-44, 24, 'var(--system-teal)'],
]
const CODE = [
  ['{ }', 40, 0, 'var(--system-blue)'],
  ['</>', 60, -0.6, 'var(--system-teal)'],
  ['01', 80, -1.2, 'var(--system-orange)'],
] as const
const limbs = [
  { part: 'lf', ox: 50, oy: 78, rest: 19 },
  { part: 'rf', ox: 70, oy: 78, rest: -19 },
] as const
const origin = (ox: number, oy: number, rest: number) => ({
  transformOrigin: `${ox}px ${oy}px`,
  '--rest': `${rest}deg`,
})
</script>

<template>
  <svg class="ui-mascot" :data-action="action" :width="size" :height="size" viewBox="0 0 120 120" aria-hidden="true">
    <ellipse class="ui-mascot__shadow" cx="60" cy="109" rx="24" ry="3" />
    <g class="ui-mascot__fig">
      <g class="ui-mascot__bob" fill="var(--brand-blue)">
        <g v-for="l in limbs" :key="l.part" :class="`ui-mascot__${l.part}`" :style="origin(l.ox, l.oy, l.rest)">
          <path :d="`M${l.ox} 78 ${l.ox + (l.rest > 0 ? -9 : 9)} 103`" fill="none" stroke="var(--brand-blue)" stroke-width="9" stroke-linecap="round" />
        </g>
        <g class="ui-mascot__la" :style="origin(40, 66.5, 90)"><rect x="22" y="62" width="22" height="9" rx="4.5" /></g>
        <g class="ui-mascot__ra" :style="origin(80, 66.5, -90)"><rect x="76" y="62" width="22" height="9" rx="4.5" /></g>
        <rect class="ui-mascot__window" x="48" y="41" width="24" height="23" rx="4" />
        <rect x="41" y="22" width="9" height="44" rx="4.5" />
        <rect x="70" y="22" width="9" height="44" rx="4.5" />
        <rect x="31" y="34" width="58" height="9" rx="4.5" />
        <rect x="38" y="62" width="44" height="9" rx="4.5" />
        <g class="ui-mascot__eyes ui-mascot__eyes--open" :fill="INK">
          <circle v-for="x in EYES" :key="x" class="ui-mascot__eye" :cx="x" cy="50.5" r="2.6" />
        </g>
        <g fill="none" :stroke="INK" stroke-width="1.8" stroke-linecap="round">
          <g class="ui-mascot__eyes ui-mascot__eyes--happy">
            <path v-for="x in EYES" :key="x" :d="`M${x - 2.4} 51.6q2.4-4.4 4.8 0`" />
          </g>
          <g class="ui-mascot__eyes ui-mascot__eyes--closed">
            <path v-for="x in EYES" :key="x" :d="`M${x - 2.4} 50.6q2.4 3 4.8 0`" />
          </g>
          <path class="ui-mascot__mouth ui-mascot__mouth--smile" d="M58.2 56.4q1.8 1.6 3.6 0" stroke-width="1.4" />
        </g>
        <path class="ui-mascot__mouth ui-mascot__mouth--open" d="M57.8 55.4h4.4a2.2 2.2 0 0 1-4.4 0Z" :fill="INK" />
        <circle cx="52.4" cy="56" r="1.6" fill="#FF8FB1" />
        <circle cx="67.6" cy="56" r="1.6" fill="#FF8FB1" />
        <g class="ui-mascot__dot">
          <circle class="ui-mascot__lamp" cx="60" cy="11.5" r="6.5" fill="var(--brand-amber)" />
        </g>
      </g>
    </g>
    <g class="ui-mascot__prop ui-mascot__prop--think">
      <circle class="ui-mascot__bubble" cx="82" cy="27" r="2.2" />
      <circle class="ui-mascot__bubble" cx="86.5" cy="21.5" r="3.2" />
      <rect class="ui-mascot__bubble" x="84" y="2" width="32" height="18" rx="9" />
      <circle v-for="(x, i) in [93, 100, 107]" :key="x" class="ui-mascot__fx" :cx="x" cy="11" r="2.1" fill="var(--system-blue)" :style="{ '--dd': `${i * 0.15}s` }" />
    </g>
    <g class="ui-mascot__prop ui-mascot__prop--type">
      <rect class="ui-mascot__laptop" x="34" y="78" width="52" height="28" rx="5" />
      <circle class="ui-mascot__glow" cx="60" cy="92" r="6" fill="var(--brand-amber)" />
      <rect class="ui-mascot__laptop-base" x="28" y="104" width="64" height="5" rx="2.5" />
      <text v-for="[t, x, d, c] in CODE" :key="t" class="ui-mascot__fx ui-mascot__code" :x="x" y="76" text-anchor="middle" :fill="c" :style="{ '--dd': `${d}s` }">{{ t }}</text>
    </g>
    <g class="ui-mascot__prop ui-mascot__prop--done">
      <component
        :is="i % 2 ? 'path' : 'rect'"
        v-for="([x, y, c], i) in CONFETTI"
        :key="`${x}${y}`"
        class="ui-mascot__fx"
        v-bind="i % 2 ? { d: 'M60 38 63 41 60 44 57 41Z' } : { x: 58.5, y: 38, width: 3, height: 6, rx: 1 }"
        :fill="c"
        :style="{ '--x': `${x}px`, '--y': `${y}px`, '--dd': `${-i * 0.06}s` }"
      />
    </g>
  </svg>
</template>
