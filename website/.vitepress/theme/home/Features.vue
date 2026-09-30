<script setup lang="ts">
import { computed } from 'vue'
import { useCopy } from './copy'
import { ICONS } from './icons'
import { vReveal } from './motion'

const { t, link } = useCopy()
const PAGES: [icon: string, path: string][] = [
  [ICONS.chat, '/user/chat'],
  [ICONS.laptop, '/guide/architecture'],
  [ICONS.eye, '/user/runs'],
  [ICONS.seal, '/user/approvals'],
  [ICONS.preview, '/user/previews'],
  [ICONS.compass, '/admin/'],
]
const FEATURES = computed(() =>
  t.value.features.items.map(([title, body], i) => ({ title, body, icon: PAGES[i][0], link: PAGES[i][1] })),
)
</script>

<template>
  <section class="features">
    <div class="gg-wrap">
      <div v-reveal class="head">
        <p class="gg-kicker gg-rise">{{ t.features.kicker }}</p>
        <h2 class="gg-h2 gg-rise" style="--i: 1">{{ t.features.title[0] }}<br />{{ t.features.title[1] }}</h2>
      </div>
      <div class="grid">
        <a
          v-for="(f, i) in FEATURES"
          :key="f.title"
          v-reveal
          class="item gg-rise"
          :style="{ '--i': i % 3 }"
          :href="link(f.link)"
        >
          <span class="icon" v-html="f.icon" />
          <h3>{{ f.title }}</h3>
          <p>{{ f.body }}</p>
          <span class="go">{{ t.features.more }} <span v-html="ICONS.arrow" /></span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.features {
  padding: clamp(96px, 14vh, 160px) 0 clamp(64px, 10vh, 120px);
  background: var(--paper);
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 56px;
  border-top: 1.5px solid var(--ink);
}
.item {
  position: relative;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 32px 28px 30px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink);
  transition: background-color 0.3s;
}
.item:not(:nth-child(3n)) {
  border-right: 1px solid var(--rule);
}
.item:hover {
  background: var(--card);
}
.icon {
  display: block;
  width: 48px;
  height: 48px;
  margin-bottom: 8px;
  transition: transform 0.4s cubic-bezier(0.3, 1.6, 0.5, 1);
}
.item:hover .icon {
  transform: rotate(-6deg) scale(1.08);
}
.icon :deep(.draw) {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset 1.4s cubic-bezier(0.6, 0, 0.2, 1) calc(var(--i, 0) * 120ms + 300ms);
}
.is-in .icon :deep(.draw),
.item.is-in .icon :deep(.draw) {
  stroke-dashoffset: 0;
}
h3 {
  margin: 0;
  font-family: var(--serif);
  font-size: 21px;
  font-weight: 700;
}
p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.75;
  color: var(--ink-2);
}
.go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-3);
  transition: color 0.2s;
}
.go :deep(svg) {
  width: 14px;
  height: 14px;
  transition: transform 0.25s;
}
.item:hover .go {
  color: var(--blue-ink);
}
.item:hover .go :deep(svg) {
  transform: translateX(4px);
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
  .item:not(:nth-child(3n)) {
    border-right: 0;
  }
  .item:nth-child(odd) {
    border-right: 1px solid var(--rule);
  }
}
@media (max-width: 560px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .item:nth-child(odd) {
    border-right: 0;
  }
  .item {
    padding: 26px 4px;
  }
}
</style>
