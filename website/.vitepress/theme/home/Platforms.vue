<script setup lang="ts">
import { withBase } from 'vitepress'
import { ref } from 'vue'
import { useCopy } from './copy'
import { ICONS } from './icons'
import { crossing, useScroll, vReveal } from './motion'

const { t, link } = useCopy()
const root = ref<HTMLElement>()
useScroll(root, (r, vh) => root.value?.style.setProperty('--c', crossing(r, vh).toFixed(4)))
</script>

<template>
  <section ref="root" class="platforms">
    <div class="gg-wrap layout">
      <div v-reveal class="copy">
        <p class="gg-kicker gg-rise">{{ t.platforms.kicker }}</p>
        <h2 class="gg-h2 gg-rise" style="--i: 1">{{ t.platforms.title[0] }}<br />{{ t.platforms.title[1] }}</h2>
        <p class="gg-lead gg-rise" style="--i: 2">{{ t.platforms.lead }}</p>
        <p class="links gg-rise" style="--i: 3">
          <a :href="link('/user/interface')">{{ t.platforms.tour }} <span v-html="ICONS.arrow" /></a>
          <a :href="link('/desktop/')">{{ t.platforms.desktop }} <span v-html="ICONS.arrow" /></a>
        </p>
      </div>
      <div class="devices" aria-hidden="true">
        <figure class="dev dev--desk" style="--k: -90">
          <div class="bar"><i /><i /><i /><span>{{ t.platforms.desktopBar }}</span></div>
          <img :src="withBase('/screenshots/desktop/overview.webp')" alt="" loading="lazy" />
        </figure>
        <figure class="dev dev--web" style="--k: 30">
          <div class="bar"><i /><i /><i /><span>gg.example.com</span></div>
          <img :src="withBase('/screenshots/web/chat.webp')" alt="" loading="lazy" />
        </figure>
        <figure class="dev dev--phone" style="--k: 150">
          <img :src="withBase('/screenshots/web/workbench-mobile.webp')" alt="" loading="lazy" />
        </figure>
      </div>
    </div>
  </section>
</template>

<style scoped>
.platforms {
  --c: 0.5;
  padding: clamp(96px, 14vh, 160px) 0;
  background: var(--paper);
  overflow: hidden;
}
.layout {
  display: grid;
  grid-template-columns: minmax(280px, 0.75fr) 1.6fr;
  gap: 48px;
  align-items: center;
}
.copy .gg-h2 {
  font-size: clamp(30px, 3.6vw, 46px);
}
.links {
  display: flex;
  gap: 24px;
  margin-top: 28px;
}
.links a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--ink);
  border-bottom: 1.5px solid var(--ink);
  padding-bottom: 2px;
}
.links a :deep(svg) {
  width: 16px;
  height: 16px;
  transition: transform 0.25s;
}
.links a:hover :deep(svg) {
  transform: translateX(4px);
}

.devices {
  position: relative;
  aspect-ratio: 1.25;
}
.dev {
  position: absolute;
  margin: 0;
  overflow: hidden;
  background: #f5f5f5;
  transform: translateY(calc((0.5 - var(--c)) * var(--k) * 1px));
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.08),
    0 30px 60px -24px rgb(27 34 51 / 0.4);
}
.dev img {
  display: block;
  width: 100%;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  font-size: 10.5px;
  color: rgb(0 0 0 / 0.5);
  border-bottom: 1px solid rgb(0 0 0 / 0.07);
}
.bar i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff5f57;
}
.bar i:nth-child(2) {
  background: #febc2e;
}
.bar i:nth-child(3) {
  background: #28c840;
}
.bar span {
  flex: 1;
  text-align: center;
  margin-right: 38px;
}
.dev--desk {
  top: 0;
  right: 0;
  width: 58%;
  border-radius: 10px;
}
.dev--web {
  left: 0;
  top: 20%;
  width: 78%;
  border-radius: 10px;
}
.dev--phone {
  right: 2%;
  bottom: -2%;
  width: 21%;
  padding: 7px;
  border-radius: 30px;
  background: #1b2233;
}
.dev--phone img {
  border-radius: 23px;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
