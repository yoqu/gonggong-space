<script setup lang="ts">
import { computed } from 'vue'
import { useCopy } from './copy'
import Mascot from './Mascot.vue'
import { vReveal } from './motion'

const { t, link } = useCopy()
const STEPS = computed(() => [
  { who: t.value.outro.admin, cmd: 'pnpm install && pnpm db:up && pnpm dev:server' },
  { who: t.value.outro.member, cmd: 'gg login --server https://gg.example.com --code K7QM-4X2P' },
  { who: t.value.outro.member, cmd: 'gg run' },
])
</script>

<template>
  <section v-reveal class="outro">
    <div class="gg-wrap">
      <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
        <path class="mark__wave" pathLength="1" d="M9 44c5 0 7-4 9-9 3-7 7-8 10-5 2 2 1 6-2 6M55 44c-5 0-7-4-9-9-3-7-7-8-10-5-2 2-1 6 2 6" />
        <path class="mark__sea" pathLength="1" d="M9 53c4.6 0 4.6-3 9.2-3s4.6 3 9.2 3 4.6-3 9.2-3 4.6 3 9.2 3 4.6-3 9.2-3" />
        <path class="mark__jade" d="M32 11 40 19 32 27 24 19Z" />
      </svg>
      <h2 class="line gg-rise" style="--i: 2">{{ t.outro.title }}</h2>
      <p class="gg-lead gg-rise" style="--i: 3">{{ t.outro.lead }}</p>

      <ol class="steps gg-rise" style="--i: 4">
        <li v-for="(s, i) in STEPS" :key="i">
          <span class="who">{{ s.who }}</span>
          <code>{{ s.cmd }}</code>
        </li>
      </ol>

      <div class="actions gg-rise" style="--i: 5">
        <a class="gg-btn gg-btn--ink" :href="link('/guide/quick-start')">{{ t.outro.start }}</a>
        <a class="gg-btn gg-btn--line" :href="link('/deploy/')">{{ t.outro.deploy }}</a>
      </div>
    </div>
    <div class="shore" aria-hidden="true">
      <div class="walker"><Mascot action="carry" :size="96" /></div>
    </div>
  </section>
</template>

<style scoped>
.outro {
  position: relative;
  padding: clamp(96px, 14vh, 160px) 0 0;
  background: var(--paper);
  text-align: center;
  overflow: hidden;
}
.outro .gg-lead {
  margin-inline: auto;
}
.mark {
  width: 96px;
  height: 96px;
  margin: 0 auto;
  overflow: visible;
}
.mark path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mark__wave,
.mark__sea {
  stroke: var(--ink);
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset 1.6s cubic-bezier(0.6, 0, 0.2, 1);
}
.mark__wave {
  stroke-width: 4.5;
}
.mark__sea {
  stroke-width: 2.6;
  stroke-opacity: 0.5;
  transition-delay: 0.3s;
}
.mark .mark__jade {
  fill: var(--jade);
  transform-box: fill-box;
  transform-origin: center;
  transform: translateY(18px) scale(0);
  transition: transform 0.9s cubic-bezier(0.3, 1.6, 0.5, 1) 1.2s;
}
.is-in .mark__wave,
.is-in .mark__sea {
  stroke-dashoffset: 0;
}
.is-in .mark .mark__jade {
  transform: none;
  animation: lift 4s ease-in-out 2.2s infinite;
}
@keyframes lift {
  50% {
    transform: translateY(-3px);
  }
}
.line {
  margin: 28px 0 16px;
  font-family: var(--serif);
  font-weight: 900;
  font-size: clamp(34px, 5.6vw, 72px);
  letter-spacing: 0.04em;
  line-height: 1.2;
}
.steps {
  display: grid;
  gap: 10px;
  width: min(680px, 100%);
  margin: 40px auto 0;
  padding: 20px 22px;
  list-style: none;
  border-radius: 16px;
  background: #1b2233;
  text-align: left;
  counter-reset: step;
}
.steps li {
  display: flex;
  align-items: baseline;
  gap: 14px;
  min-width: 0;
  counter-increment: step;
}
.steps li::before {
  content: counter(step);
  font: 600 12px var(--mono);
  color: #6b7488;
}
.who {
  flex: none;
  width: 3.4em;
  font-size: 12px;
  color: #8fa3be;
}
.steps code {
  overflow-x: auto;
  white-space: nowrap;
  font: 13.5px/1.7 var(--mono);
  color: #e9e6de;
  background: none;
  padding: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 36px;
}

.shore {
  position: relative;
  height: 150px;
  margin-top: 72px;
  background:
    radial-gradient(24px 14px at 50% 0, transparent 96%, var(--w1)) 0 36px / 48px 100% repeat-x;
}
.walker {
  position: absolute;
  top: 0;
  left: 0;
  animation: walk 26s linear infinite;
}
.walker :deep(svg) {
  animation: face 26s steps(1) infinite;
}
@keyframes walk {
  0% {
    transform: translateX(-120px);
  }
  50% {
    transform: translateX(calc(100vw + 20px));
  }
  100% {
    transform: translateX(-120px);
  }
}
@keyframes face {
  0% {
    transform: none;
  }
  50% {
    transform: scaleX(-1);
  }
}
</style>
