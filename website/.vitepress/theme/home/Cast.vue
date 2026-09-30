<script setup lang="ts">
import { ref } from 'vue'
import { PERSONAS, personaScene } from '../../../../apps/web/src/features/bots/personas'
import { useCopy } from './copy'
import { crossing, useScroll, vReveal } from './motion'

const ACTS = [
  'type',
  'think',
  'carry',
  'idle',
  'run',
  'raise',
  'wave',
  'ask',
  'wait',
  'type',
  'sleep',
  'done',
] as const
const cast = PERSONAS.map((ip, i) => ({ ip, act: ACTS[i % ACTS.length] }))
const rows = [cast.slice(0, 6), cast.slice(6)]

const { t, isEn } = useCopy()
const root = ref<HTMLElement>()
const hot = ref<string>()
useScroll(root, (r, vh) => root.value?.style.setProperty('--c', crossing(r, vh).toFixed(4)))
</script>

<template>
  <section ref="root" class="cast">
    <div v-reveal class="gg-wrap head">
      <p class="gg-kicker gg-rise">{{ t.cast.kicker }}</p>
      <h2 class="gg-h2 gg-rise" style="--i: 1">{{ t.cast.title }}</h2>
      <p class="gg-lead gg-rise" style="--i: 2">{{ t.cast.lead }}</p>
    </div>
    <div v-for="(row, r) in rows" :key="r" class="row" :class="`row--${r}`">
      <article
        v-for="c in row"
        :key="c.ip.key"
        class="card"
        @pointerenter="hot = c.ip.key"
        @pointerleave="hot = undefined"
      >
        <img :src="personaScene(c.ip, hot === c.ip.key ? 'done' : c.act)" width="112" height="112" alt="" />
        <div>
          <h3>
            {{ c.ip.name }}<small v-if="isEn">{{ t.cast.personas[c.ip.key].gloss }}</small>
          </h3>
          <p class="mix">{{ isEn ? t.cast.personas[c.ip.key].mix : c.ip.mix }}</p>
          <p>{{ isEn ? t.cast.personas[c.ip.key].line : c.ip.line }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.cast {
  --c: 0.5;
  padding: clamp(96px, 14vh, 160px) 0;
  background: var(--paper-2);
  overflow: hidden;
}
.row {
  display: flex;
  gap: 20px;
  width: max-content;
  margin-top: 20px;
  will-change: transform;
}
.row--0 {
  margin-top: 56px;
  transform: translateX(calc(12vw - var(--c) * 60vw));
}
.row--1 {
  transform: translateX(calc(-70vw + var(--c) * 60vw));
}
.card {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 400px;
  padding: 18px 22px 18px 14px;
  border-radius: 18px;
  background: var(--card);
  box-shadow: inset 0 0 0 1px var(--rule);
  transition:
    transform 0.35s cubic-bezier(0.3, 1.5, 0.5, 1),
    box-shadow 0.3s;
}
.card:hover {
  transform: translateY(-6px) rotate(-1deg);
  box-shadow:
    inset 0 0 0 1.5px var(--ink),
    5px 6px 0 var(--ink);
}
.card img {
  flex: none;
}
.card h3 {
  margin: 0;
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
}
.card h3 small {
  margin-left: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}
.card p {
  margin: 4px 0 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--ink-2);
}
.card .mix {
  margin-top: 2px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

@media (max-width: 640px) {
  .card {
    width: 300px;
  }
  .card img {
    width: 84px;
    height: 84px;
  }
}
</style>
