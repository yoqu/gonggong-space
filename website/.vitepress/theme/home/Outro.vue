<script setup lang="ts">
import { computed } from 'vue'
import { useCopy } from './copy'
import Mascot from './Mascot.vue'
import { vReveal } from './motion'

const { t, link } = useCopy()
const STEPS = computed(() => t.value.outro.steps.map(([who, cmd]) => ({ who: t.value.outro[who], cmd })))
</script>

<template>
  <section v-reveal class="outro">
    <div class="gg-wrap">
      <svg class="mark" viewBox="0 0 256 256" aria-hidden="true">
        <path class="mark__g" fill="#3B7BFF" d="M18 95A52 52 0 1 1 122 95A52 52 0 1 1 18 95ZM46 95A24 24 0 1 0 94 95A24 24 0 1 0 46 95ZM94 57A14 14 0 0 1 122 57V161A52 52 0 0 1 70 213H52A14 14 0 0 1 52 185H70A24 24 0 0 0 94 161Z" />
        <path class="mark__g" fill="#FFB224" d="M134 95A52 52 0 1 1 238 95A52 52 0 1 1 134 95ZM162 95A24 24 0 1 0 210 95A24 24 0 1 0 162 95ZM210 57A14 14 0 0 1 238 57V161A52 52 0 0 1 186 213H168A14 14 0 0 1 168 185H186A24 24 0 0 0 210 161Z" />
        <circle class="mark__pupil" cx="75" cy="99" r="11" />
        <circle class="mark__pupil" cx="191" cy="99" r="11" />
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
.mark path,
.mark circle {
  transform-box: fill-box;
  transform-origin: center;
}
.mark__pupil {
  fill: #10203a;
}
.dark .mark__pupil {
  fill: #fff;
}
.mark__g {
  opacity: 0;
  transform: translateY(14px) scale(0.6);
  transition:
    opacity 0.4s ease-out,
    transform 0.9s cubic-bezier(0.3, 1.6, 0.5, 1);
}
.mark__g + .mark__g {
  transition-delay: 0.12s;
}
.mark .mark__pupil {
  transform: scale(0);
  transition: transform 0.6s cubic-bezier(0.3, 1.6, 0.5, 1) 0.5s;
}
.is-in .mark__g {
  opacity: 1;
  transform: none;
}
.is-in .mark .mark__pupil {
  transform: none;
  animation: glance 4.8s ease-in-out 1.6s infinite;
}
@keyframes glance {
  0%,
  18%,
  100% {
    transform: none;
  }
  26%,
  44% {
    transform: translate(-9px, -5px);
  }
  52%,
  70% {
    transform: translate(3px, -7px);
  }
  78% {
    transform: none;
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
  min-width: 0;
  overflow-wrap: anywhere;
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
