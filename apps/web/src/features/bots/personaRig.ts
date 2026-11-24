import type { MascotAction, MascotMove } from '../../ui'
import { AGENT_SPEC } from './agentActs'
import { PERSONA_SPEC } from './personaActs'
import { type Persona, face as renderFace } from './personaModel'
import { HOPS, profileOf } from './rigHops'
import { ARMS, GAITS, IDLES, RIG_BASE, type RigActResult, type RigOpts } from './rigPrimitives'

const ALL_SPEC = { ...PERSONA_SPEC, ...AGENT_SPEC }

/** Renders one self-contained animated SVG document for any persona/agent across all 14 states and moves. */
export function rigScene(ip: Persona, act: MascotAction | MascotMove, opts: RigOpts = {}): string {
  const profile = profileOf(ip.key)
  const T = ip.tempo || 1
  let r: RigActResult
  if (act === 'walk') {
    r = GAITS[profile.gait](ip, T)
  } else if (act === 'hop') {
    r = HOPS[profile.hop](ip)
  } else {
    const specFn = ALL_SPEC[ip.key]?.[act]
    r = specFn ? specFn(ip, T, opts) : { css: ARMS[profile.arms] + IDLES[profile.idle](T) }
  }
  const faceKey = r.face || (act === 'hop' ? 'happy' : 'open')
  const faceMarkup = renderFace(ip, faceKey)
  const own = r.noOwn
    ? ''
    : act === 'idle' || act === 'walk' || act === 'wait' || act === 'think' || r.own
      ? ip.motion.replaceAll('var(--t)', String(T))
      : ''
  const animRule = opts.still
    ? '*{animation:none!important}'
    : '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
  const css = RIG_BASE + (r.css || '') + own + animRule
  const glove = (x: number, cls: string) =>
    `<g class="${cls}"><circle cx="${x}" cy="27" r="3.6" fill="${ip.to}" stroke="#fff" stroke-width="1.3"/></g>`
  const foot = (x: number, cls: string) =>
    `<g class="${cls}"><ellipse cx="${x}" cy="43.6" rx="4.4" ry="2.4" fill="${ip.to}" stroke="#fff" stroke-width="1.1"/></g>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -24 84 82" style="--t:${T}"><style>${css}</style>` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ip.from}"/><stop offset="1" stop-color="${ip.to}"/></linearGradient><clipPath id="t"><rect width="40" height="40" rx="9"/></clipPath></defs>` +
    `<ellipse class="r-shadow" cx="20" cy="47" rx="14" ry="1.8" fill="#000" opacity=".12"/>${r.back || ''}` +
    `<g class="r-root"><g class="r-lean">${foot(13, 'r-lf')}${foot(27, 'r-rf')}` +
    `<g class="r-body"><g class="r-spin"><rect width="40" height="40" rx="9" fill="url(#g)"/><g clip-path="url(#t)">${ip.glyph(ip.to, faceMarkup, faceKey)}</g></g></g>` +
    `${glove(-2.5, 'r-la')}${glove(42.5, 'r-ra')}${r.held || ''}</g></g>${r.front || ''}</svg>`
  )
}
