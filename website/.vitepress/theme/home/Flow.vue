<script setup lang="ts">
import { computed } from 'vue'
import { useCopy } from './copy'
import { ICONS } from './icons'
import { vReveal } from './motion'

const { t, link } = useCopy()
const ICON = [ICONS.chat, ICONS.server, ICONS.laptop]
const NODES = computed(() =>
  t.value.flow.nodes.map((n, i) => ({
    ...n,
    icon: ICON[i],
    chips: i === 2 ? ['Claude Code', 'Codex'] : undefined,
  })),
)
const LINKS = computed(() => t.value.flow.links)
const RIVER = 'M0 30 C40 12 60 12 100 30 S160 48 200 30'
</script>

<template>
  <section v-reveal class="flow">
    <div class="gg-wrap">
      <p class="gg-kicker gg-rise">{{ t.flow.kicker }}</p>
      <h2 class="gg-h2 gg-rise" style="--i: 1">{{ t.flow.title[0] }}<br />{{ t.flow.title[1] }}</h2>
      <p class="gg-lead gg-rise" style="--i: 2">{{ t.flow.lead }}</p>

      <div class="river">
        <template v-for="(n, i) in NODES" :key="n.name">
          <article class="node gg-rise" :style="{ '--i': 3 + i * 2 }">
            <span class="node__icon" v-html="n.icon" />
            <h3>{{ n.name }}</h3>
            <p class="node__where">{{ n.where }}</p>
            <p>{{ n.body }}</p>
            <p v-if="n.chips" class="chips">
              <span v-for="c in n.chips" :key="c">{{ c }}</span>
            </p>
          </article>
          <div v-if="LINKS[i]" class="link gg-rise" :style="{ '--i': 4 + i * 2 }" aria-hidden="true">
            <span class="link__down">{{ LINKS[i].down }} →</span>
            <svg viewBox="0 0 200 60" preserveAspectRatio="none">
              <path :id="`river${i}`" class="link__bed" :d="RIVER" />
              <path class="link__flow" :d="RIVER" />
              <g class="packets">
                <path v-for="k in 3" :key="`d${k}`" d="M-5 0 0 -5 5 0 0 5Z" fill="var(--blue)">
                  <animateMotion :dur="`${3 + i * 0.4}s`" :begin="`${-k}s`" repeatCount="indefinite">
                    <mpath :href="`#river${i}`" />
                  </animateMotion>
                </path>
                <circle v-for="k in 2" :key="`u${k}`" r="3.4" fill="var(--jade)">
                  <animateMotion
                    :dur="`${3.6 + i * 0.3}s`"
                    :begin="`${-k * 1.6}s`"
                    repeatCount="indefinite"
                    keyPoints="1;0"
                    keyTimes="0;1"
                    calcMode="linear"
                  >
                    <mpath :href="`#river${i}`" />
                  </animateMotion>
                </circle>
              </g>
            </svg>
            <span class="link__up">← {{ LINKS[i].up }}</span>
          </div>
        </template>
      </div>

      <p class="more gg-rise" style="--i: 9">
        <a :href="link('/guide/architecture')">{{ t.flow.more }} <span v-html="ICONS.arrow" /></a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.flow {
  position: relative;
  padding: clamp(96px, 14vh, 160px) 0;
  background: var(--paper-2);
}
.flow::before {
  content: '';
  position: absolute;
  inset: -1px 0 auto;
  height: 40px;
  background: var(--paper);
  mask: radial-gradient(28px 22px at 50% 0, #000 98%, transparent) 0 0 / 56px 40px repeat-x;
}

.river {
  display: grid;
  grid-template-columns: 1fr minmax(120px, 0.7fr) 1fr minmax(120px, 0.7fr) 1fr;
  align-items: stretch;
  margin-top: 56px;
}
.node {
  position: relative;
  padding: 26px 24px 24px;
  border-radius: 18px;
  background: var(--card);
  box-shadow:
    inset 0 0 0 1.5px var(--ink),
    5px 6px 0 var(--ink);
}
.node__icon {
  display: block;
  width: 52px;
  height: 52px;
  color: var(--ink);
}
.node h3 {
  margin: 14px 0 2px;
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 700;
}
.node p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--ink-2);
}
.node .node__where {
  margin-bottom: 10px;
  font-size: 12.5px;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}
.node .chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.chips span {
  padding: 3px 10px;
  border-radius: 999px;
  font: 600 12px var(--mono);
  color: var(--ink);
  background: color-mix(in srgb, var(--jade) 16%, transparent);
}

.link {
  position: relative;
  align-self: center;
  display: grid;
  gap: 6px;
  padding: 0 6px;
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
}
.link svg {
  width: 100%;
  height: 60px;
  overflow: visible;
}
.link__bed {
  fill: none;
  stroke: color-mix(in srgb, var(--w2) 60%, transparent);
  stroke-width: 14;
  stroke-linecap: round;
}
.link__flow {
  fill: none;
  stroke: var(--paper-2);
  stroke-width: 1.5;
  stroke-dasharray: 6 10;
  animation: stream 1.2s linear infinite;
}
@keyframes stream {
  to {
    stroke-dashoffset: -16;
  }
}
.link__down {
  color: var(--blue-ink);
}
.link__up {
  color: color-mix(in srgb, var(--jade) 70%, var(--ink));
}

.more {
  margin-top: 48px;
}
.more a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--ink);
  border-bottom: 1.5px solid var(--ink);
  padding-bottom: 2px;
}
.more a :deep(svg) {
  width: 16px;
  height: 16px;
  transition: transform 0.25s;
}
.more a:hover :deep(svg) {
  transform: translateX(4px);
}

.node__icon :deep(.draw) {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset 1.4s cubic-bezier(0.6, 0, 0.2, 1) calc(var(--i, 0) * 90ms + 200ms);
}
.is-in .node__icon :deep(.draw) {
  stroke-dashoffset: 0;
}

@media (max-width: 860px) {
  .river {
    grid-template-columns: 1fr;
    justify-items: stretch;
  }
  .link {
    grid-template-columns: 1fr 60px 1fr;
    align-items: center;
    height: 96px;
  }
  .link svg {
    grid-column: 2;
    grid-row: 1;
    width: 96px;
    justify-self: center;
    transform: rotate(90deg);
  }
  .link__down {
    grid-column: 1;
    grid-row: 1;
    text-align: right;
  }
  .link__up {
    grid-column: 3;
    grid-row: 1;
    text-align: left;
  }
}
@media (prefers-reduced-motion: reduce) {
  .packets {
    display: none;
  }
}
</style>
