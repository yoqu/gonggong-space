import type { MascotAction } from '../../ui'

export type Face = 'open' | 'happy' | 'closed' | 'x' | 'wink'

export interface ActExtra {
  face?: Face
  css?: string
  fx?: string
  z?: string
}

/** What the persona does for an action: a caption, the word or style its prop carries, and any twists. */
export type Act = [caption: string, prop?: string, extra?: ActExtra]

export interface Persona {
  key: string
  name: string
  mix: string
  /** One line on how it works. */
  line: string
  /** Multiplies every loop: above 1 is slower. */
  tempo: number
  from: string
  to: string
  /** Eye centres, mouth centre and face scale for the drawn expressions. */
  E: [number, number][]
  M: [number, number]
  s: number
  eyeInk?: string
  mouthInk?: string
  open: (ink: string) => string
  glyph: (ink: string, face: string, state?: Face) => string
  motion: string
  acts: Record<MascotAction, Act>
}

const stroke = (c: string, w: number) =>
  `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`

/** Renders one of the 5 standard face expressions using the persona's eye/mouth geometry. */
export function face(ip: Persona, st: Face) {
  if (st === 'open') return ip.open(ip.to)
  const k = ip.eyeInk || ip.to
  const m = ip.mouthInk || ip.to
  const s = ip.s
  const w = 1.8 * s
  const [mx, my] = ip.M
  const arc = (x: number, y: number, up?: number) =>
    `M${x - w} ${y + (up ? 0.6 : -0.2)}q${w} ${up ? -2.4 * s : 1.8 * s} ${2 * w} 0`
  const cross = (x: number, y: number) => {
    const d = 1.4 * s
    return `M${x - d} ${y - d}l${2 * d} ${2 * d}m0 ${-2 * d}l${-2 * d} ${2 * d}`
  }
  const [[x1, y1], [x2, y2]] = ip.E as [[number, number], [number, number]]
  let eyes: string
  let mouth: string
  if (st === 'happy') {
    eyes = `<path d="${arc(x1, y1, 1)}${arc(x2, y2, 1)}" ${stroke(k, 1.4)}/>`
    mouth = `<path d="M${mx - 2.6 * s} ${my - 0.8}h${5.2 * s}a${2.6 * s} ${2.6 * s} 0 0 1 ${-5.2 * s} 0z" fill="${m}"/>`
  } else if (st === 'closed') {
    eyes = `<path d="${arc(x1, y1)}${arc(x2, y2)}" ${stroke(k, 1.4)}/>`
    mouth = `<path d="M${mx - 1.4} ${my}q1.4 1 2.8 0" ${stroke(m, 1.2)}/>`
  } else if (st === 'x') {
    eyes = `<path d="${cross(x1, y1)}${cross(x2, y2)}" ${stroke(k, 1.3)}/>`
    mouth = `<path d="M${mx - 2.4} ${my}q.6-.9 1.2 0t1.2 0 1.2 0 1.2 0" ${stroke(m, 1.1)}/>`
  } else {
    eyes = `<ellipse cx="${x1}" cy="${y1}" rx="${1.4 * s}" ry="${1.7 * s}" fill="${k}"/><path d="${arc(x2, y2)}" ${stroke(k, 1.4)}/>`
    mouth = `<path d="M${mx - 1.4} ${my}q1.4 .6 2.8 0" ${stroke(m, 1.2)}/>`
  }
  return eyes + mouth
}
