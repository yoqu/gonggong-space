<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PERSONAS } from '../../../../apps/web/src/features/bots/personas'
import { useCopy } from './copy'
import Hero from './Hero.vue'
import type { BrandCopy, HeroScene, StudioCopy } from './hero3d'
import { pinned, reducedMotion, useScroll } from './motion'
import type { createStudioSound } from './studioSound'
import './home.css'

const root = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const bubbles = ref<HTMLElement[]>([])
const stamp = ref<HTMLElement>()
const links = ref<HTMLAnchorElement[]>([])
const hover = ref(-1)
const fallback = ref(false)
const ready = ref(false)
const soundOn = ref(false)
const { t, isEn, link } = useCopy()

// The relay the studio plays out, in the page language: who says what to whom.
const STUDIO: Record<'zh' | 'en', StudioCopy & { seal: string }> = {
  zh: {
    group: 'todo-app 开发群',
    names: ['小林', '共字君', '前端小助手', '后端助手', '测试助手'],
    badges: ['前端', '后端', '测试'],
    lines: [
      '@共字君 列表加个筛选',
      '@前端小助手 交给你了',
      '</> 组件好了 @后端助手 接口交给你',
      '@测试助手 接口好了，跑一下',
      '✓ 12 passed · 请审批',
    ],
    approved: '准 · 合并上线',
    process: '过程',
    typing: '正在输入…',
    columns: ['待办', '进行中', '审核', '完成'],
    task: '筛选',
    online: '在线 · 成员机器',
    seal: '准',
  },
  en: {
    group: 'todo-app dev',
    names: ['Lin', 'Gonggong', 'Frontend Bot', 'Backend Bot', 'Test Bot'],
    badges: ['UI', 'API', 'QA'],
    lines: [
      '@Gonggong add a filter to the list',
      '@Frontend Bot it’s yours',
      '</> UI done · @Backend Bot API next',
      '@Test Bot API ready, run it',
      '✓ 12 passed · approve?',
    ],
    approved: 'Approved · merging',
    process: 'Live',
    typing: 'is typing…',
    columns: ['To do', 'Doing', 'Review', 'Done'],
    task: 'Filter',
    online: 'online',
    seal: 'OK',
  },
}
const studio = computed(() => STUDIO[isEn.value ? 'en' : 'zh'])
const SENDERS = [0, 1, 2, 3, 4]
const brand = computed<BrandCopy>(() => ({
  title: t.value.hero.title,
  seal: ['共', '工'],
  slogan: t.value.hero.slogan.join(isEn.value ? ' ' : ''),
  kicker: t.value.hero.kicker,
  tagline: t.value.hero.tagline,
  actions: [t.value.hero.start, t.value.hero.about, 'GitHub'],
}))
const ACTIONS = computed(() => [
  { href: link('/guide/quick-start'), text: t.value.hero.start, external: false },
  { href: link('/guide/introduction'), text: t.value.hero.about, external: false },
  { href: 'https://github.com/yoqu/gonggong-space', text: 'GitHub', external: true },
])
const AVATARS = [
  '#c23b22',
  '#2f6bff',
  ...['abacus', 'no', 'steps'].map((k) => PERSONAS.find((p) => p.key === k)?.to),
]

let scene: HeroScene | undefined
let sound: ReturnType<typeof createStudioSound> | undefined
let io: IntersectionObserver | undefined
let ro: ResizeObserver | undefined
let mo: MutationObserver | undefined
let visible = false
let alive = true

useScroll(root, (r, vh) => {
  const p = pinned(r, vh)
  root.value?.style.setProperty('--p', p.toFixed(3))
  scene?.setScroll(p)
})

const isDark = () => document.documentElement.classList.contains('dark')
const sync = () => scene?.setActive(visible && !document.hidden)
const onPointer = (e: PointerEvent) => {
  if (e.pointerType === 'mouse')
    scene?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1)
}
const webgl = () => {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

onMounted(async () => {
  if (!webgl()) {
    fallback.value = true
    return
  }
  const { createHeroScene } = await import('./hero3d')
  const el = canvas.value
  if (!alive || !el || !root.value || !stamp.value) return
  const still = reducedMotion()
  try {
    scene = createHeroScene({
      canvas: el,
      bubbles: bubbles.value,
      stamp: stamp.value,
      copy: studio.value,
      brand: brand.value,
      still,
      dark: isDark(),
      onSound: (s) => sound?.play(s),
      onFirstFrame: () => {
        ready.value = true
      },
    })
  } catch {
    fallback.value = true
    return
  }
  ro = new ResizeObserver(([e]) => scene?.resize(e.contentRect.width, e.contentRect.height))
  ro.observe(el)
  io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    sync()
    if (soundOn.value) sound?.set(visible)
  })
  io.observe(root.value)
  mo = new MutationObserver(() => scene?.setDark(isDark()))
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  document.addEventListener('visibilitychange', sync)
  if (!still) addEventListener('pointermove', onPointer, { passive: true })
})
onBeforeUnmount(() => {
  alive = false
  io?.disconnect()
  ro?.disconnect()
  mo?.disconnect()
  document.removeEventListener('visibilitychange', sync)
  removeEventListener('pointermove', onPointer)
  scene?.dispose()
  sound?.dispose()
})

// The title and actions are drawn in the room; real (visually hidden) links carry focus, Enter and SEO.
const at = (e: PointerEvent | MouseEvent) => scene?.pick(e.offsetX, e.offsetY) ?? -1
const onHover = (e: PointerEvent) => {
  if (e.pointerType !== 'mouse') return
  hover.value = at(e)
  scene?.setHighlight(hover.value)
}
const onLeave = () => {
  hover.value = -1
  scene?.setHighlight(-1)
}
const activate = async (i: number) => {
  await scene?.press(i)
  links.value[i]?.click()
}
const onTap = (e: MouseEvent) => {
  const i = at(e)
  if (i >= 0) void activate(i)
}

// Audio can only start from a gesture, so the sound engine is built on the first press.
const toggleSound = async () => {
  if (!sound) sound = (await import('./studioSound')).createStudioSound()
  soundOn.value = !soundOn.value
  sound.set(soundOn.value)
}
</script>

<template>
  <Hero v-if="fallback" />
  <section v-else ref="root" class="hero3d" :class="{ en: isEn, ready }">
    <div class="hero3d__pin">
      <canvas
        ref="canvas"
        class="stage"
        :class="{ pointing: hover >= 0 }"
        aria-hidden="true"
        @pointermove="onHover"
        @pointerleave="onLeave"
        @click="onTap"
      />
      <div class="bubbles" aria-hidden="true">
        <span v-for="(line, i) in studio.lines" :key="i" ref="bubbles" class="say">
          <i class="say__who" :style="{ background: AVATARS[SENDERS[i]] }" />
          <b>{{ studio.names[SENDERS[i]] }}</b>
          <span v-for="(part, j) in line.split(/(@\S+)/)" :key="j" :class="{ at: part.startsWith('@') }">{{ part }}</span>
        </span>
        <span ref="stamp" class="stamp">{{ studio.seal }}</span>
      </div>

      <div class="sr">
        <h1>{{ t.hero.title }}</h1>
        <p>{{ t.hero.kicker }}</p>
        <p>{{ brand.slogan }}</p>
        <p>{{ t.hero.tagline }}</p>
        <a
          v-for="(a, i) in ACTIONS"
          :key="a.href"
          ref="links"
          :href="a.href"
          :target="a.external ? '_blank' : undefined"
          :rel="a.external ? 'noreferrer' : undefined"
          @focus="scene?.setHighlight(i)"
          @blur="scene?.setHighlight(hover)"
          @keydown.enter.prevent="activate(i)"
          >{{ a.text }}</a
        >
      </div>

      <button
        class="sound"
        type="button"
        :aria-pressed="soundOn"
        :aria-label="isEn ? 'Studio sound' : '工作室声音'"
        :title="isEn ? (soundOn ? 'Mute' : 'Sound on') : soundOn ? '静音' : '打开声音'"
        @click="toggleSound"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
          <template v-if="soundOn">
            <path d="M15.5 9a4 4 0 0 1 0 6" />
            <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
          </template>
          <path v-else d="m16 9.5 5 5m0-5-5 5" />
        </svg>
      </button>
    </div>
  </section>
</template>

<style scoped>
.hero3d {
  position: relative;
  height: 180vh;
  margin-top: calc(-1 * var(--vp-nav-height));
}
.hero3d__pin {
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100svh;
  min-height: 600px;
  overflow: hidden;
  background: linear-gradient(to bottom, var(--paper) 40%, color-mix(in srgb, var(--w1) 60%, var(--paper)));
}
.stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0;
  transition: opacity 1.2s ease;
}
.ready .stage {
  opacity: 1;
}

.bubbles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.say {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 7px 12px 7px 8px;
  border-radius: 14px 14px 14px 4px;
  background: var(--card);
  box-shadow:
    inset 0 0 0 1px var(--rule),
    0 12px 28px -14px rgb(27 34 51 / 0.55);
  font: 500 13px/1.35 var(--font-sans);
  color: var(--ink);
  white-space: nowrap;
  opacity: 0;
  transform: translate(-50%, -100%) scale(0.7);
  transform-origin: 50% 100%;
  transition:
    opacity 0.25s,
    transform 0.4s cubic-bezier(0.3, 1.5, 0.5, 1);
}
.say.on {
  opacity: 1;
  transform: translate(-50%, -100%);
}
.say__who {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.5);
}
.say b {
  font-weight: 700;
  color: var(--ink-2);
}
.say .at {
  color: var(--blue);
  font-weight: 600;
}
.stamp {
  position: absolute;
  left: 0;
  top: 0;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 8px;
  background: var(--seal);
  color: #fbf3ea;
  font: 900 26px/1 var(--serif);
  box-shadow:
    inset 0 0 0 3px rgb(255 255 255 / 0.25),
    0 10px 24px -10px rgb(194 59 34 / 0.7);
  opacity: 0;
  transform: translate(-50%, -100%) rotate(-8deg) scale(2.2);
  transition:
    opacity 0.15s,
    transform 0.25s cubic-bezier(0.5, 0, 0.7, 1.4);
}
.en .stamp {
  font: 800 18px/1 var(--font-sans);
}
.stamp.on {
  opacity: 1;
  transform: translate(-50%, -100%) rotate(-8deg);
}
@media (max-width: 767px) {
  .say {
    font-size: 11px;
    padding: 5px 9px 5px 6px;
    max-width: 72vw;
    white-space: normal;
  }
  .say b {
    display: none;
  }
  .stamp {
    width: 42px;
    height: 42px;
    font-size: 20px;
  }
}

.sound {
  position: absolute;
  right: max(16px, calc((100vw - 1200px) / 2));
  bottom: 24px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  color: var(--ink);
  background: color-mix(in srgb, var(--card) 70%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ink) 40%, transparent);
  backdrop-filter: blur(6px);
  cursor: pointer;
  transition: transform 0.2s;
}
.sound:hover {
  transform: scale(1.08);
}
.sound svg {
  width: 20px;
  height: 20px;
}

/* As the hero unpins, its bottom melts into the paper so the next section doesn't meet a hard edge. */
.hero3d__pin::before {
  content: "";
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  height: 30%;
  background: linear-gradient(to top, var(--paper), transparent);
  opacity: var(--p, 0);
  pointer-events: none;
}
/* Keeps the site nav legible over the scene in both themes. */
.hero3d__pin::after {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: calc(var(--vp-nav-height) + 40px);
  background: linear-gradient(to bottom, color-mix(in srgb, var(--paper) 88%, transparent), transparent);
  pointer-events: none;
}
.stage.pointing {
  cursor: pointer;
}
/* Visually hidden but focusable: the real heading and links behind the 3D title and actions. */
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
