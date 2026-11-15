<script setup lang="ts">
import { useCopy } from './copy'
import GgMark from './GgMark.vue'
import { vReveal } from './motion'

const { t, isEn, link } = useCopy()
</script>

<template>
  <section v-reveal class="hero" :class="{ en: isEn }">
    <div class="gg-wrap hero__grid">
      <div class="hero__copy">
        <p class="gg-kicker gg-rise">{{ t.hero.kicker }}</p>
        <h1 class="title gg-rise" style="--i: 1">{{ t.hero.title }}</h1>
        <p class="slogan gg-rise" style="--i: 2">
          {{ t.hero.slogan[0] }}<br /><em>{{ t.hero.slogan[1] }}</em>
        </p>
        <p class="tagline gg-rise" style="--i: 3">{{ t.hero.tagline }}</p>
        <div class="actions gg-rise" style="--i: 4">
          <a class="gg-btn gg-btn--ink" :href="link('/guide/quick-start')">{{ t.hero.start }}</a>
          <a class="gg-btn gg-btn--line" :href="link('/guide/introduction')">{{ t.hero.about }}</a>
          <a class="gg-btn gg-btn--text" href="https://github.com/yoqu/gonggong-space" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.38.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg>
            GitHub
          </a>
        </div>
      </div>

      <div class="hero__art" aria-hidden="true">
        <span class="orbit orbit--1" />
        <span class="orbit orbit--2" />
        <GgMark class="hero__mark" track />
        <p v-for="(c, i) in t.hero.chips" :key="i" class="chip" :class="`chip--${i}`" :style="{ '--i': i }">
          <b>{{ c.who }}</b>{{ c.text }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  margin-top: calc(-1 * var(--vp-nav-height));
  padding: calc(var(--vp-nav-height) + clamp(32px, 8vh, 96px)) 0 clamp(56px, 10vh, 120px);
  overflow: hidden;
  background:
    radial-gradient(48% 60% at 82% 38%, var(--blue-wash), transparent 70%),
    radial-gradient(30% 40% at 96% 80%, var(--amber-wash), transparent 70%);
}
.hero__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  align-items: center;
  gap: 48px;
}

.title {
  margin: 20px 0 0;
  font-family: var(--display);
  font-weight: 800;
  font-size: clamp(52px, 7.6vw, 104px);
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.slogan {
  margin: 22px 0 0;
  font-family: var(--display);
  font-weight: 700;
  font-size: clamp(24px, 2.8vw, 36px);
  line-height: 1.3;
  color: var(--ink);
}
.slogan em {
  font-style: normal;
  color: var(--blue);
}
.tagline {
  margin: 18px 0 0;
  max-width: 30em;
  font-size: 16px;
  line-height: 1.8;
  color: var(--ink-2);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.hero__art {
  position: relative;
  aspect-ratio: 1;
  max-width: 520px;
  width: 100%;
  justify-self: center;
  display: grid;
  place-items: center;
}
.hero__mark {
  width: 62%;
  height: auto;
}
.orbit {
  position: absolute;
  inset: 4%;
  border-radius: 50%;
  border: 1.5px dashed var(--rule);
  animation: spin 80s linear infinite;
}
.orbit--2 {
  inset: 18%;
  border-style: solid;
  border-color: color-mix(in srgb, var(--blue) 14%, transparent);
  animation-direction: reverse;
  animation-duration: 120s;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.chip {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 15em;
  margin: 0;
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--card);
  box-shadow: var(--shadow);
  font-size: 13px;
  line-height: 1.45;
  color: var(--ink);
  opacity: 0;
  animation:
    chip-in 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) calc(0.9s + var(--i) * 0.5s) both,
    float 6s ease-in-out calc(var(--i) * -2s) infinite;
}
.chip b {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
}
.chip--0 {
  top: 8%;
  left: -2%;
  border-bottom-left-radius: 4px;
}
.chip--1 {
  top: 56%;
  right: -8%;
  border-bottom-right-radius: 4px;
}
.chip--1 b {
  color: var(--blue-ink);
}
.chip--2 {
  bottom: 6%;
  left: 6%;
  border-bottom-left-radius: 4px;
  box-shadow:
    inset 0 0 0 1.5px var(--amber),
    var(--shadow);
}
.chip--2 b {
  color: var(--amber-ink);
}
@keyframes chip-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes float {
  50% {
    translate: 0 -6px;
  }
}

.en .title {
  font-size: clamp(44px, 6vw, 84px);
}
.en .slogan {
  font-size: clamp(22px, 2.4vw, 32px);
}

@media (max-width: 860px) {
  .hero__grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .hero__art {
    max-width: 380px;
  }
  .chip {
    font-size: 12px;
  }
  .actions .gg-btn {
    height: 42px;
    padding: 0 18px;
  }
}
</style>
