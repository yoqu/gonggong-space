import { type Directive, onBeforeUnmount, onMounted, type Ref } from 'vue'

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
export const smooth = (t: number) => t * t * (3 - 2 * t)
/** Progress through a tall section whose child is `position: sticky`: 0 when it pins, 1 when it unpins. */
export const pinned = (r: DOMRect, vh: number) => clamp(-r.top / (r.height - vh))
/** Progress of an element crossing the viewport: 0 as its top enters from below, 1 as its bottom leaves above. */
export const crossing = (r: DOMRect, vh: number) => clamp((vh - r.top) / (vh + r.height))

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Calls `update` once per frame while the element is near the viewport and the page scrolls or resizes. */
export function useScroll(target: Ref<HTMLElement | undefined>, update: (r: DOMRect, vh: number) => void) {
  let raf = 0
  let near = false
  let io: IntersectionObserver | undefined
  const tick = () => {
    raf = 0
    if (target.value) update(target.value.getBoundingClientRect(), window.innerHeight)
  }
  const schedule = () => {
    if (near && !raf) raf = requestAnimationFrame(tick)
  }
  onMounted(() => {
    const el = target.value
    if (!el) return
    io = new IntersectionObserver(
      ([e]) => {
        near = e.isIntersecting
        schedule()
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    tick()
  })
  onBeforeUnmount(() => {
    io?.disconnect()
    removeEventListener('scroll', schedule)
    removeEventListener('resize', schedule)
    cancelAnimationFrame(raf)
  })
}

/** Adds `is-in` the first time the element scrolls into view; CSS decides what that reveals. */
export const vReveal: Directive<HTMLElement> = {
  mounted(el) {
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        el.classList.add('is-in')
        io.disconnect()
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(el)
  },
}
