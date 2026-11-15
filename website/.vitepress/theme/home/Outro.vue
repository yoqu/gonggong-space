<script setup lang="ts">
import { computed } from 'vue'
import { useCopy } from './copy'
import GgMark from './GgMark.vue'
import { vReveal } from './motion'

const { t, link } = useCopy()
const STEPS = computed(() => t.value.outro.steps.map(([who, cmd]) => ({ who: t.value.outro[who], cmd })))
</script>

<template>
  <section v-reveal class="outro">
    <div class="gg-wrap">
      <GgMark class="mark" track />
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
        <a class="gg-btn gg-btn--on-ink" :href="link('/deploy/')">{{ t.outro.deploy }}</a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.outro {
  --brand-pupil: #fff;
  position: relative;
  padding: clamp(96px, 14vh, 160px) 0;
  background: var(--brand-ink);
  color: #fff;
  text-align: center;
  overflow: hidden;
}
.outro .gg-lead {
  margin-inline: auto;
  color: rgb(255 255 255 / 0.68);
}
.mark {
  width: 112px;
  height: 112px;
  margin: 0 auto;
}
.line {
  margin: 28px 0 16px;
  font-family: var(--display);
  font-weight: 800;
  font-size: clamp(34px, 5.2vw, 64px);
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: #fff;
}
.steps {
  display: grid;
  gap: 10px;
  width: min(680px, 100%);
  margin: 40px auto 0;
  padding: 20px 22px;
  list-style: none;
  border-radius: 16px;
  background: rgb(255 255 255 / 0.06);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
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
  color: var(--brand-amber);
}
.who {
  flex: none;
  width: 3.4em;
  font-size: 12px;
  color: rgb(255 255 255 / 0.5);
}
.steps code {
  min-width: 0;
  overflow-wrap: anywhere;
  font: 13.5px/1.7 var(--mono);
  color: #e8eefb;
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
.gg-btn--on-ink {
  color: #fff;
  box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.5);
}
.gg-btn--on-ink:hover {
  box-shadow: inset 0 0 0 1.5px #fff;
}
</style>
