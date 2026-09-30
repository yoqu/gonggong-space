<script setup lang="ts">
import { withBase } from 'vitepress'
import { computed, ref } from 'vue'
import { useCopy } from './copy'
import Mascot from './Mascot.vue'
import { clamp, pinned, smooth, useScroll } from './motion'

// Real product screenshots, all 2880×1800 of the same session; rects below are in their 2000×1250 display units.
const SHOTS = {
  A: 'screenshots/web/process-panel.webp',
  B: 'screenshots/web/diff-pane.webp',
  C: 'screenshots/web/workbench-split.webp',
} as const
type Shot = keyof typeof SHOTS
/** The deepest zoom; the camera layer is laid out this large and scaled down so zooming never upsamples. */
const MAX = 2.8
type Rect = [x: number, y: number, w: number, h: number]
const FULL: Rect = [0, 0, 2000, 1250]

const KEYS: [p: number, shot: Shot, focus: Rect][] = [
  [0, 'A', FULL],
  [0.06, 'A', FULL],
  [0.16, 'A', [500, 180, 560, 330]],
  [0.27, 'A', [500, 180, 560, 330]],
  [0.37, 'A', [100, 450, 960, 660]],
  [0.5, 'A', [100, 450, 960, 660]],
  [0.58, 'A', [1030, 70, 970, 600]],
  [0.63, 'B', [1030, 70, 970, 600]],
  [0.67, 'B', [1030, 330, 970, 620]],
  [0.75, 'B', [1030, 330, 970, 620]],
  [0.83, 'C', [1026, 0, 974, 1250]],
  [0.91, 'C', FULL],
  [1, 'C', FULL],
]

const MARKS: { from: number; to: number; rect: Rect }[] = [
  { from: 0.15, to: 0.27, rect: [612, 226, 326, 232] },
  { from: 0.36, to: 0.51, rect: [762, 478, 196, 26] },
  { from: 0.4, to: 0.51, rect: [126, 876, 196, 48] },
  { from: 0.555, to: 0.6, rect: [1052, 252, 248, 28] },
  { from: 0.595, to: 0.645, rect: [1468, 182, 76, 26] },
  { from: 0.67, to: 0.76, rect: [1058, 472, 560, 94] },
  { from: 0.84, to: 0.92, rect: [1040, 16, 740, 40] },
]

const CHAPTERS = [
  { no: '壹', act: 'wave', end: 0.27 },
  { no: '贰', act: 'type', end: 0.52 },
  { no: '叁', act: 'think', end: 0.77 },
  { no: '肆', act: 'done', end: 1.01 },
]
const { t } = useCopy()

const root = ref<HTMLElement>()
const view = ref<HTMLElement>()
const p = ref(0)
const width = ref(1000)
useScroll(root, (r, vh) => {
  p.value = pinned(r, vh)
  width.value = view.value?.offsetWidth ?? width.value
})

const frame = computed(() => {
  const i = Math.max(
    0,
    KEYS.findIndex((_, j) => j === KEYS.length - 1 || p.value < KEYS[j + 1][0]),
  )
  const a = KEYS[i]
  const b = KEYS[Math.min(i + 1, KEYS.length - 1)]
  const t = b === a ? 0 : smooth(clamp((p.value - a[0]) / (b[0] - a[0])))
  return { a, b, t }
})

/** Fit a rect into the 16:10 viewport: its zoom and centre, as fractions of the shot. */
const lens = ([x, y, w, h]: Rect) => ({
  s: clamp(Math.min(2000 / w, 1250 / h) * 0.94, 1, MAX),
  cx: (x + w / 2) / 2000,
  cy: (y + h / 2) / 1250,
})
const camera = computed(() => {
  const { a, b, t } = frame.value
  const u = lens(a[2])
  const v = lens(b[2])
  const s = u.s * (v.s / u.s) ** t
  // A constant 2.5px pen whatever the zoom (non-scaling strokes break pathLength dashes).
  const pen = (2.5 * 2000) / (width.value * s)
  const pos = (c: number) => (clamp(0.5 - c * s, 1 - s, 0) / MAX) * 100
  const cx = u.cx + (v.cx - u.cx) * t
  const cy = u.cy + (v.cy - u.cy) * t
  return { transform: `translate(${pos(cx)}%, ${pos(cy)}%) scale(${s / MAX})`, '--pen': pen }
})
const shown = (shot: Shot) => {
  const { a, b, t } = frame.value
  if (a[1] === b[1]) return a[1] === shot ? 1 : 0
  // Cut in the middle of the move, like switching a tab, rather than dissolving along it.
  return shot === a[1] ? 1 : shot === b[1] ? smooth(clamp((t - 0.4) / 0.25)) : 0
}
const chapter = computed(() => CHAPTERS.findIndex((c) => p.value < c.end))
const mention = computed(() => clamp((p.value - 0.02) / 0.05) * (1 - clamp((p.value - 0.12) / 0.04)))

/** A pen loop around a rect that overshoots its start, like a reviewer circling something. */
const loop = ([x, y, w, h]: Rect) => {
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2 + 18
  const ry = h / 2 + 14
  const pts = Array.from({ length: 57 }, (_, i) => {
    const a = -2.2 + (i / 48) * Math.PI * 2
    const wob = 1 + Math.sin(i * 0.45) * 0.035 + i * 0.0012
    return [cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]
  })
  return `M${pts.map((q) => q.map((n) => n.toFixed(1)).join(' ')).join(' L')}`
}
const ink = (m: (typeof MARKS)[number]) => {
  const draw = clamp((p.value - m.from) / 0.035)
  const fade = 1 - clamp((p.value - m.to) / 0.02)
  return { strokeDashoffset: 1 - draw, opacity: fade }
}
</script>

<template>
  <section ref="root" class="stage">
    <div class="stage__pin">
      <div class="stage__grid gg-wrap">
        <div class="story">
          <p class="gg-kicker">{{ t.stage.kicker }}</p>
          <h2 class="gg-h2">{{ t.stage.title[0] }}<br />{{ t.stage.title[1] }}</h2>
          <ol class="chapters">
            <li v-for="(c, i) in CHAPTERS" :key="c.no" :class="{ on: i === chapter, past: i < chapter }">
              <span class="no">{{ c.no }}</span>
              <div>
                <h3>{{ t.stage.chapters[i].title }}</h3>
                <p>{{ t.stage.chapters[i].body }}</p>
              </div>
            </li>
          </ol>
          <div class="meter"><i :style="{ transform: `scaleX(${p})` }" /></div>
        </div>

        <div class="window">
          <div class="window__bar">
            <span class="lights"><i /><i /><i /></span>
            <span class="window__title">{{ t.stage.window }}</span>
          </div>
          <div ref="view" class="viewport">
            <div class="cam" :style="camera">
              <img
                v-for="(src, k) in SHOTS"
                :key="k"
                :src="withBase(`/${src}`)"
                :style="{ opacity: shown(k) }"
                alt=""
                loading="lazy"
                decoding="async"
              />
              <svg class="marks" viewBox="0 0 2000 1250" preserveAspectRatio="none" aria-hidden="true">
                <path v-for="(m, i) in MARKS" :key="i" :d="loop(m.rect)" pathLength="1" :style="ink(m)" />
              </svg>
            </div>
            <figure
              class="mention"
              :style="{ opacity: mention, transform: `translateY(${(1 - mention) * 24}px) scale(${0.96 + mention * 0.04})` }"
            >
              <img :src="withBase('/screenshots/web/composer-mention.webp')" :alt="t.stage.mention" loading="lazy" />
            </figure>
          </div>
          <div class="buddy" aria-hidden="true">
            <Mascot :action="CHAPTERS[Math.max(chapter, 0)].act" :size="96" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  height: 560vh;
  background: var(--paper);
}
.stage__pin {
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100svh;
  display: grid;
  align-items: center;
  padding-top: var(--vp-nav-height);
}
.stage__grid {
  display: grid;
  grid-template-columns: minmax(280px, 340px) 1fr;
  gap: clamp(28px, 4vw, 64px);
  align-items: center;
  width: min(1360px, 100% - 48px);
}

.story .gg-h2 {
  font-size: clamp(28px, 3vw, 40px);
}
.chapters {
  list-style: none;
  margin: 28px 0 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.chapters li {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 6px;
  padding: 12px 0;
  border-top: 1px solid var(--rule);
  color: var(--ink-3);
  transition: color 0.4s;
}
.chapters .no {
  font-family: var(--serif);
  font-size: 20px;
  line-height: 1.3;
}
.chapters h3 {
  margin: 0;
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 700;
  line-height: 1.4;
}
.chapters p {
  margin: 0;
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  font-size: 14.5px;
  line-height: 1.75;
  color: var(--ink-2);
  transition:
    max-height 0.6s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.5s,
    margin 0.6s;
}
.chapters li.past {
  color: var(--ink-2);
}
.chapters li.on {
  color: var(--ink);
}
.chapters li.on .no {
  color: var(--seal);
}
.chapters li.on p {
  max-height: 8em;
  opacity: 1;
  margin-top: 8px;
}
.meter {
  height: 2px;
  margin-top: 8px;
  background: var(--rule);
}
.meter i {
  display: block;
  height: 100%;
  background: var(--ink);
  transform-origin: left;
}

.window {
  position: relative;
  width: min(100%, calc((100svh - var(--vp-nav-height) - 96px) * 1.6));
  justify-self: center;
  border-radius: 14px;
  background: #f5f5f5;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.08),
    0 30px 70px -20px rgb(27 34 51 / 0.35),
    0 12px 24px -12px rgb(27 34 51 / 0.2);
}
.window__bar {
  position: relative;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  font-size: 12px;
  color: rgb(0 0 0 / 0.55);
}
.lights {
  position: absolute;
  left: 14px;
  display: flex;
  gap: 8px;
}
.lights i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ff5f57;
}
.lights i:nth-child(2) {
  background: #febc2e;
}
.lights i:nth-child(3) {
  background: #28c840;
}
.viewport {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 0 0 14px 14px;
  background: #fff;
}
.cam {
  position: absolute;
  top: 0;
  left: 0;
  width: 280%;
  height: 280%;
  transform-origin: 0 0;
}
.cam img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.marks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.marks path {
  fill: none;
  stroke: var(--seal);
  stroke-width: var(--pen);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
}
.mention {
  position: absolute;
  left: 4%;
  bottom: 5%;
  width: 62%;
  margin: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.08),
    0 24px 48px -16px rgb(27 34 51 / 0.45);
  pointer-events: none;
}
.mention img {
  display: block;
  width: 100%;
}
.buddy {
  position: absolute;
  left: -34px;
  bottom: -30px;
}

@media (max-width: 900px) {
  .stage {
    height: 460vh;
  }
  .stage__pin {
    padding-top: calc(var(--vp-nav-height) + 40px);
  }
  .stage__grid {
    grid-template-columns: 1fr;
    gap: 18px;
    width: calc(100% - 32px);
  }
  .story {
    order: 2;
  }
  .story .gg-kicker,
  .chapters li:not(.on) {
    display: none;
  }
  .story .gg-h2 {
    position: absolute;
    top: calc(var(--vp-nav-height) + 16px);
    left: 16px;
    margin: 0;
    font-size: 24px;
  }
  .chapters {
    margin: 0;
  }
  .window {
    width: 100%;
  }
  .window__bar {
    height: 26px;
  }
  .lights i {
    width: 9px;
    height: 9px;
  }
  .window__title {
    display: none;
  }
  .buddy {
    left: auto;
    right: -8px;
    bottom: -44px;
  }
  .buddy :deep(svg) {
    width: 64px;
    height: 64px;
  }
}
</style>
