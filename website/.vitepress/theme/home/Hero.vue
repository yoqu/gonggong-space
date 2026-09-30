<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PERSONAS, personaScene } from '../../../../apps/web/src/features/bots/personas'
import { useCopy } from './copy'
import Mascot from './Mascot.vue'
import { clamp, pinned, reducedMotion, smooth, useClock, useScroll } from './motion'

const root = ref<HTMLElement>()
const narrow = ref(false)
const { t, isEn, link } = useCopy()
const W = 1440
// Portrait screens get a wider, shorter strip of the scene under the copy instead of a sliver of it.
const box = computed(() =>
  narrow.value
    ? { viewBox: '300 0 1140 900', preserveAspectRatio: 'xMidYMax meet' }
    : { viewBox: `0 0 ${W} 900`, preserveAspectRatio: 'xMidYMax slice' },
)

useScroll(root, (r, vh) => root.value?.style.setProperty('--p', pinned(r, vh).toFixed(4)))

/*
 * The team on the rocks passes the jade along: 共字君 asks (@), one Bot builds (</>), the next checks (✓), and the jade
 * sails back for the next round. One 9-second loop; each leg is a thrown arc, each stop a short hold.
 */
const HANDS: [number, number][] = [
  [450, 640],
  [724, 694],
  [974, 668],
]
const LEG = 1.3
const HOLD = 1.7
const CYCLE = (LEG + HOLD) * 3
const clock = useClock(root, CYCLE, HOLD * 0.6)
const relay = computed(() => {
  const k = clock.value / (LEG + HOLD)
  const i = Math.floor(k)
  const f = (k - i) * (LEG + HOLD)
  const [x0, y0] = HANDS[i]
  const [x1, y1] = HANDS[(i + 1) % 3]
  const u = smooth(clamp((f - HOLD) / LEG))
  const back = i === 2
  // The throw back to 共字君 flies high over the water.
  const lift = back ? 150 : 90
  return {
    x: x0 + (x1 - x0) * u,
    y: y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * lift,
    spin: u * (back ? 360 : 180),
    at: u < 0.5 ? i : (i + 1) % 3,
    holding: f < HOLD,
  }
})
const persona = (key: string, act: 'idle' | 'type' | 'done' | 'wave') =>
  personaScene(PERSONAS.find((p) => p.key === key) ?? PERSONAS[0], act, false)
const BUBBLES = ['@', '</>', '✓']

// The pointer tilts the scene; layers move by their own depth.
let raf = 0
let aim = [0, 0]
let now = [0, 0]
const follow = () => {
  now = now.map((v, i) => v + (aim[i] - v) * 0.08)
  root.value?.style.setProperty('--mx', now[0].toFixed(4))
  root.value?.style.setProperty('--my', now[1].toFixed(4))
  raf = Math.abs(now[0] - aim[0]) + Math.abs(now[1] - aim[1]) > 0.001 ? requestAnimationFrame(follow) : 0
}
const onPointer = (e: PointerEvent) => {
  if (e.pointerType !== 'mouse') return
  aim = [(e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1]
  if (!raf) raf = requestAnimationFrame(follow)
}
const fit = () => {
  narrow.value = innerWidth < 768
}
onMounted(() => {
  fit()
  addEventListener('resize', fit)
  if (!reducedMotion()) addEventListener('pointermove', onPointer, { passive: true })
})
onBeforeUnmount(() => {
  removeEventListener('resize', fit)
  removeEventListener('pointermove', onPointer)
  cancelAnimationFrame(raf)
})

/** A row of scalloped crests across the scene, one period wider so it can loop sideways. */
const crests = (y: number, len: number, amp: number) => {
  let d = `M${-len} ${y}`
  for (let x = -len; x < W + len; x += len) d += ` q${len / 2} ${-amp} ${len} 0`
  return d
}
const WAVES = [
  { y: 792, len: 64, amp: 10, dur: 9, o: 0.9 },
  { y: 818, len: 80, amp: 12, dur: 12, o: 0.7 },
  { y: 848, len: 96, amp: 14, dur: 15, o: 0.55 },
  { y: 882, len: 120, amp: 16, dur: 19, o: 0.4 },
]
const SURGE =
  'M-40 900C-20 820 40 760 110 736 166 716 222 726 240 760 254 788 238 812 214 812 196 812 186 796 196 784 204 776 216 780 216 790 200 800 170 790 160 800 130 830 150 880 190 900Z'
const FOAM = [
  [252, 742, 5],
  [266, 766, 3.5],
  [258, 722, 3],
]
const PINES = [
  [96, 600, 1],
  [132, 612, 0.8],
  [240, 648, 0.9],
]
const pine = (x: number, y: number, s: number) =>
  `M${x} ${y - 70 * s} L${x + 18 * s} ${y - 40 * s} H${x + 8 * s} L${x + 26 * s} ${y - 12 * s} H${x + 6 * s} V${y} H${x - 6 * s} V${y - 12 * s} H${x - 26 * s} L${x - 8 * s} ${y - 40 * s} H${x - 18 * s}Z`
</script>

<template>
  <section ref="root" class="hero" :class="{ narrow, en: isEn }">
    <div class="hero__pin">
      <div class="scene" aria-hidden="true">
        <svg class="layer" style="--d: 0.05; --k: 30; --s: 0" v-bind="box">
          <circle class="sun" cx="1290" cy="250" r="118" />
          <circle cx="1290" cy="250" r="140" fill="none" stroke="var(--ink)" stroke-opacity=".18" stroke-width="1.5" stroke-dasharray="3 7" />
          <g v-for="(c, i) in [[740, 150, 0.8], [800, 400, 0.55], [1250, 520, 0.5]]" :key="i" class="cloud" :style="{ '--x': `${c[0]}px`, '--y': `${c[1]}px`, '--c': c[2], '--dur': `${50 + i * 14}s` }">
            <path class="cloud__body" d="M-10 60C-10 42 18 32 34 40 40 16 82 8 100 28 114 14 148 20 152 44 166 44 178 52 178 60Z" />
            <path class="cloud__curl" d="M-40 60H220M22 60C6 58 4 36 20 34 32 33 34 48 24 49M64 58C58 30 92 18 108 36 120 50 108 64 96 58 88 54 92 44 100 46M132 60C132 44 156 40 162 54" />
          </g>
        </svg>
        <svg class="layer" style="--d: 0.12; --k: 80; --s: 0.02" v-bind="box">
          <path fill="var(--m1)" d="M0 600C60 580 110 540 170 548 230 556 260 500 330 490 400 480 430 530 500 520 560 512 600 470 660 476 730 484 760 540 840 530 900 522 930 490 990 486 1060 482 1100 520 1170 512 1250 502 1300 470 1360 474 1400 478 1420 500 1440 506V900H0Z" />
        </svg>
        <svg class="layer" style="--d: 0.22; --k: 120; --s: 0.04" v-bind="box">
          <path fill="var(--m2)" d="M0 560C40 520 70 450 120 430 150 418 170 460 200 470 240 484 270 420 320 410 370 400 390 480 450 520 520 566 600 600 700 610 800 620 880 596 960 602L1440 650V900H0Z" />
          <path class="ridge" d="M120 430C150 418 170 460 200 470M320 410C370 400 390 480 450 520" />
        </svg>
        <svg class="layer" style="--d: 0.34; --k: 150; --s: 0.06" v-bind="box">
          <g transform="translate(1117 900) scale(.84) translate(-1117 -900)">
          <g class="peak">
            <path fill="var(--m3)" d="M978 900 985 780C1000 700 1010 630 1005 560 1000 480 1022 420 1030 360 1036 300 1048 250 1060 210L1098 196 1112 214 1140 186 1178 176C1186 230 1196 290 1192 360 1188 440 1206 520 1214 600 1220 680 1236 740 1250 780L1258 900Z" />
            <path fill="var(--m2)" d="M1140 186 1178 176C1186 230 1196 290 1192 360 1188 440 1206 520 1214 600 1220 680 1236 740 1250 780L1258 900H1150L1150 780C1160 680 1150 600 1156 520 1162 430 1150 330 1148 250Z" opacity=".85" />
            <path class="ridge" d="M978 900 985 780C1000 700 1010 630 1005 560 1000 480 1022 420 1030 360 1036 300 1048 250 1060 210L1098 196 1112 214 1140 186 1178 176C1186 230 1196 290 1192 360 1188 440 1206 520 1214 600 1220 680 1236 740 1250 780" />
            <path class="strata" d="M1034 392C1054 400 1074 398 1096 388M1022 478C1052 488 1076 486 1104 474M1044 600C1072 612 1100 610 1128 596M1170 300C1178 330 1178 360 1168 392M1186 470C1194 510 1192 550 1182 590M1060 270C1074 276 1090 274 1104 266" />
          </g>
          <path class="shard" d="M1150 128 1190 116 1204 138 1180 156 1152 148Z" />
          <g class="jewel">
            <circle class="jewel__ring" cx="1116" cy="98" r="40" />
            <circle class="jewel__ring" cx="1116" cy="98" r="40" style="animation-delay: -2s" />
            <path d="M1116 66 1146 98 1116 130 1086 98Z" fill="url(#jade)" />
            <path d="M1116 66 1146 98H1116Z" fill="#fff" opacity=".5" />
          </g>
          </g>
          <defs>
            <linearGradient id="jade" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#b8f5ea" />
              <stop offset="1" stop-color="#14b3ae" />
            </linearGradient>
          </defs>
        </svg>
        <svg class="layer" style="--d: 0.5; --k: 260; --s: 0.1" v-bind="box">
          <path fill="var(--m4)" d="M0 680C60 640 110 610 170 628 220 642 250 690 320 700 380 708 430 750 480 810V900H0Z" />
          <path fill="var(--m4)" d="M840 830C920 750 1010 722 1090 744 1160 712 1270 700 1350 745 1400 772 1440 784 1440 784V900H840Z" />
          <path class="ridge ridge--light" d="M0 680C60 640 110 610 170 628 220 642 250 690 320 700 380 708 430 750 480 810M840 830C920 750 1010 722 1090 744 1160 712 1270 700 1350 745 1400 772 1440 784 1440 784" />
          <path v-for="[x, y, s] in PINES" :key="x" class="pine" :d="pine(x, y, s)" />
        </svg>
        <svg class="layer" style="--d: 0.7; --k: 360; --s: 0.14" v-bind="box">
          <rect y="780" :width="W" height="120" fill="var(--w1)" />
          <path v-for="w in WAVES" :key="w.y" class="crest" :d="crests(w.y, w.len, w.amp)" :style="{ '--len': `${w.len}px`, '--dur': `${w.dur}s`, opacity: w.o }" />
        </svg>
        <svg class="layer layer--front" style="--d: 1; --k: 560; --s: 0.2" v-bind="box">
          <defs>
            <linearGradient id="surge" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#2f6bff" />
              <stop offset="1" stop-color="#0fa3a0" />
            </linearGradient>
          </defs>
          <path class="rock" d="M330 900C328 860 350 826 392 816 430 806 470 812 494 826 530 818 560 836 566 866 570 884 568 900Z" />
          <path class="ridge ridge--light" d="M372 846C392 840 410 844 424 852M494 830C512 838 530 840 546 836" />
          <path class="rock rock--low" d="M650 872C656 852 676 842 700 840 730 838 760 842 780 852 794 860 800 868 800 872Z" />
          <path class="rock rock--low" d="M900 848C906 826 928 814 956 812 988 810 1018 816 1034 830 1044 838 1046 846 1046 848Z" />
          <Mascot :action="relay.at === 0 && relay.holding ? 'wave' : 'idle'" :size="170" x="365" y="663" />
          <image :href="persona('braces', relay.at === 1 && relay.holding ? 'type' : 'idle')" x="660" y="724" width="128" height="128" />
          <image :href="persona('sentry', relay.at === 2 && relay.holding ? 'done' : 'idle')" x="908" y="692" width="130" height="130" />
          <g v-for="(b, i) in BUBBLES" :key="b" class="say" :class="{ on: relay.at === i && relay.holding }" :transform="`translate(${HANDS[i][0] + 34} ${HANDS[i][1] - 58})`">
            <rect x="-4" y="-22" :width="b.length * 11 + 22" height="30" rx="15" />
            <path d="M6 7 2 16 16 7Z" />
            <text :x="b.length * 5.5 + 7" y="-2" text-anchor="middle">{{ b }}</text>
          </g>
          <g class="baton" :transform="`translate(${relay.x} ${relay.y}) rotate(${relay.spin})`">
            <circle r="22" class="baton__glow" />
            <path d="M0 -15 15 0 0 15 -15 0Z" fill="url(#jade)" />
            <path d="M0 -15 15 0H0Z" fill="#fff" opacity=".5" />
          </g>
          <g class="surge surge--l">
            <path class="surge__body" :d="SURGE" />
            <path class="surge__foam" d="M4 820C40 776 96 744 160 736" />
            <circle v-for="[x, y, r] in FOAM" :key="x" class="surge__dot" :cx="x" :cy="y" :r="r" />
          </g>
          <g transform="translate(1440 0) scale(-1 1)">
            <g class="surge surge--r">
              <path class="surge__body" :d="SURGE" />
              <path class="surge__foam" d="M4 820C40 776 96 744 160 736" />
              <circle v-for="[x, y, r] in FOAM" :key="x" class="surge__dot" :cx="x" :cy="y" :r="r" />
            </g>
          </g>
        </svg>
      </div>

      <div class="hero__copy gg-wrap">
        <p class="gg-kicker">{{ t.hero.kicker }}</p>
        <h1 class="title">
          <span class="title__main">{{ t.hero.title }}</span>
          <span class="seal" aria-hidden="true"><i>共</i><i>工</i></span>
        </h1>
        <p class="slogan">{{ t.hero.slogan[0] }}<br />{{ t.hero.slogan[1] }}</p>
        <p class="tagline">{{ t.hero.tagline }}</p>
        <div class="actions">
          <a class="gg-btn gg-btn--ink" :href="link('/guide/quick-start')">{{ t.hero.start }}</a>
          <a class="gg-btn gg-btn--line" :href="link('/guide/introduction')">{{ t.hero.about }}</a>
          <a class="gg-btn gg-btn--text" href="https://github.com/yoqu/gonggong-space" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.38.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg>
            GitHub
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  --p: 0;
  --mx: 0;
  --my: 0;
  position: relative;
  height: 180vh;
  margin-top: calc(-1 * var(--vp-nav-height));
}
.hero__pin {
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100svh;
  min-height: 600px;
  overflow: hidden;
  background: linear-gradient(to bottom, var(--paper) 30%, color-mix(in srgb, var(--w1) 45%, var(--paper)));
}

.scene,
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.layer {
  transform-origin: 50% 100%;
  transform: translate3d(calc(var(--mx) * var(--d) * -28px), calc(var(--p) * var(--k) * 1px + var(--my) * var(--d) * -10px), 0)
    scale(calc(1 + var(--p) * var(--s)));
  will-change: transform;
}

.sun {
  fill: var(--sun);
}
.cloud {
  transform: translate(var(--x), var(--y)) scale(var(--c));
  animation: drift var(--dur) ease-in-out infinite alternate;
}
.cloud__body {
  fill: var(--cloud);
}
.cloud__curl {
  fill: none;
  stroke: var(--ink);
  stroke-opacity: 0.45;
  stroke-width: 1.6;
  stroke-linecap: round;
}
@keyframes drift {
  to {
    transform: translate(calc(var(--x) + 60px), var(--y)) scale(var(--c));
  }
}

.ridge {
  fill: none;
  stroke: var(--ink);
  stroke-opacity: 0.55;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ridge--light {
  stroke-opacity: 0.35;
}
.strata {
  fill: none;
  stroke: var(--ink);
  stroke-opacity: 0.28;
  stroke-width: 1.6;
  stroke-linecap: round;
}
.shard {
  fill: var(--m3);
  stroke: var(--ink);
  stroke-opacity: 0.55;
  stroke-width: 2;
  stroke-linejoin: round;
  transform-box: fill-box;
  transform-origin: center;
  animation: shard 7s ease-in-out infinite;
}
@keyframes shard {
  50% {
    transform: translate(6px, -8px) rotate(-8deg);
  }
}
.jewel {
  transform-box: fill-box;
  transform-origin: center;
  transform: translateY(calc(var(--p) * -170px)) scale(calc(1 + var(--p) * 0.8));
}
.jewel > path:first-of-type {
  animation: bob 4s ease-in-out infinite;
}
.jewel__ring {
  fill: none;
  stroke: var(--jade);
  stroke-width: 1.5;
  transform-box: fill-box;
  transform-origin: center;
  animation: ring 4s ease-out infinite;
}
@keyframes bob {
  50% {
    transform: translateY(-8px);
  }
}
@keyframes ring {
  from {
    transform: scale(0.6);
    opacity: 0.9;
  }
  to {
    transform: scale(1.8);
    opacity: 0;
  }
}
.pine {
  fill: color-mix(in srgb, var(--m4) 60%, var(--ink));
}

.crest {
  fill: none;
  stroke: var(--w2);
  stroke-width: 2;
  stroke-linecap: round;
  animation: flow var(--dur) linear infinite;
}
@keyframes flow {
  to {
    transform: translateX(var(--len));
  }
}

.rock {
  fill: color-mix(in srgb, var(--m4) 55%, var(--ink));
}
.surge__body {
  fill: url(#surge);
}
.surge__foam {
  fill: none;
  stroke: #fff;
  stroke-opacity: 0.55;
  stroke-width: 3;
  stroke-linecap: round;
}
.surge__dot {
  fill: var(--w2);
}
.surge {
  animation: surge 6s ease-in-out infinite;
  transform-origin: 0 900px;
}
.surge--r {
  animation-delay: -3s;
}
@keyframes surge {
  50% {
    transform: rotate(-1.5deg) translateY(8px);
  }
}

.hero__copy {
  position: relative;
  padding-top: calc(var(--vp-nav-height) + clamp(24px, 9vh, 96px));
  transform: translateY(calc(var(--p) * -220px));
  opacity: calc(1 - var(--p) * 2.2);
}
.title {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  margin: 22px 0 0;
  font-family: var(--serif);
  font-weight: 900;
  font-size: clamp(56px, 9.5vw, 128px);
  line-height: 1;
  letter-spacing: 0.06em;
  color: var(--ink);
}
.seal {
  display: grid;
  gap: 1px;
  padding: 6px 5px;
  border-radius: 6px;
  background: var(--seal);
  color: #fbf3ea;
  font-size: clamp(14px, 1.4vw, 18px);
  font-style: normal;
  line-height: 1.1;
  letter-spacing: 0;
  transform: rotate(4deg) translateY(0.3em);
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.18);
}
.seal i {
  font-style: normal;
}
.slogan {
  margin: 22px 0 0;
  font-family: var(--serif);
  font-weight: 700;
  font-size: clamp(24px, 3vw, 38px);
  line-height: 1.35;
  letter-spacing: 0.04em;
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
  margin-top: 30px;
}

.say {
  opacity: 0;
  transition: opacity 0.25s;
}
.say.on {
  opacity: 1;
}
.say rect,
.say path {
  fill: var(--card);
  stroke: var(--ink);
  stroke-width: 1.5;
}
.say path {
  stroke: none;
}
.say text {
  font: 700 17px var(--mono);
  fill: var(--ink);
}
.baton__glow {
  fill: var(--jade);
  opacity: 0.14;
}
.rock--low {
  fill: var(--m4);
  stroke: color-mix(in srgb, var(--m4) 55%, var(--ink));
  stroke-width: 2;
}

.en .title {
  font-size: clamp(40px, 5.6vw, 80px);
  letter-spacing: 0;
}
.en .slogan {
  font-size: clamp(22px, 2.4vw, 32px);
  letter-spacing: 0;
}
.narrow .hero__copy {
  padding-top: calc(var(--vp-nav-height) + 20px);
}
.narrow .tagline {
  font-size: 15px;
}
.narrow .actions .gg-btn {
  height: 42px;
  padding: 0 18px;
}
</style>
