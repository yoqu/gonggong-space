import type { BotAvatar as RoleKey } from '@gonggong/protocol'
import { BOT_AVATARS } from '@gonggong/protocol'
import { useId } from 'react'
import { useWorkspace } from '../../app/workspace'
import { Avatar, type AvatarProps, type MascotCostume } from '../../ui'
import { PERSONAS, personaScene } from './personas'

interface Role {
  name: string
  /** The traits it blends, e.g. 深思 × 逆向 × 守边界. */
  mix: string
  /** One line on how it works. */
  line: string
  /** Tile gradient; `to` doubles as the ink of the face. */
  from: string
  to: string
  glyph: (ink: string) => string
  /** The live avatar's signature move, keyed on classes in the glyph. */
  motion: string
}

const W = '#fff'
const stroke = (color: string, w: number) =>
  `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`

const GONG: Role = {
  name: '共字君',
  mix: '默认角色',
  line: '品牌吉祥物，什么活都肯接，把大家托举在一起',
  from: '#2f6bff',
  to: '#0fa3a0',
  glyph: (ink) =>
    `<path class="jade" d="M20 3.2 22.9 6.1 20 9 17.1 6.1Z" fill="#b8f5ea"/>` +
    `<g class="legs" ${stroke(W, 3.2)}><path d="M16.4 28.4 13.8 34.6"/><path d="M23.6 28.4l2.6 6.2"/></g>` +
    `<rect x="15" y="15.6" width="10" height="10" rx="1.6" fill="${W}"/>` +
    `<g fill="${W}"><rect x="12.2" y="9.4" width="3.6" height="17.6" rx="1.8"/><rect x="24.2" y="9.4" width="3.6" height="17.6" rx="1.8"/>` +
    `<rect x="8.6" y="13.4" width="22.8" height="3.6" rx="1.8"/><rect x="9.8" y="24.6" width="20.4" height="3.6" rx="1.8"/></g>` +
    `<ellipse cx="17.9" cy="20.2" rx="1.3" ry="1.6" fill="${ink}"/><ellipse cx="22.1" cy="20.2" rx="1.3" ry="1.6" fill="${ink}"/>` +
    `<circle cx="16.6" cy="22.6" r=".8" fill="#ff8fb1"/><circle cx="23.4" cy="22.6" r=".8" fill="#ff8fb1"/>`,
  motion:
    '.jade{animation:float 1.6s ease-in-out infinite}@keyframes float{50%{transform:translateY(-1.4px)}}' +
    '.legs path{transform-box:fill-box;transform-origin:50% 0;animation:step .5s ease-in-out infinite alternate}' +
    '.legs path+path{animation-direction:alternate-reverse}@keyframes step{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}',
}

export const ROLES = Object.fromEntries([
  ['role-gong', GONG],
  ...PERSONAS.map((ip) => [
    `role-${ip.key}`,
    {
      name: ip.name,
      mix: ip.mix,
      line: ip.line,
      from: ip.from,
      to: ip.to,
      glyph: (ink: string) => ip.glyph(ink, ip.open(ink), 'open'),
      motion: ip.motion.replaceAll('var(--t)', String(ip.tempo)),
    },
  ]),
]) as Record<RoleKey, Role>

const cache = new Map<string, string>()

/** SVG data URI, so the avatar works anywhere `<Avatar src>` does; `live` adds the role's signature move. */
export function avatarSrc(key: RoleKey, live = false) {
  const id = live ? `${key}!` : key
  let src = cache.get(id)
  if (!src) {
    const { from, to, glyph, motion } = ROLES[key]
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
      (live
        ? `<style>${motion}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>`
        : '') +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      `<rect width="40" height="40" fill="url(#g)"/>${glyph(to)}</svg>`
    src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    cache.set(id, src)
  }
  return src
}

export type PersonaRole = Exclude<RoleKey, 'role-gong'>

const costumes = new Map<PersonaRole, MascotCostume>()

/** The chat mascot played by a personality: its own scene for every action. */
export function roleCostume(key: PersonaRole): MascotCostume {
  let c = costumes.get(key)
  if (!c) {
    const role = key.slice('role-'.length)
    const ip = PERSONAS.find((p) => p.key === role) as (typeof PERSONAS)[number]
    c = { role, scene: (action, words) => personaScene(ip, action, words) }
    costumes.set(key, c)
  }
  return c
}

/** The chat mascot dressed as a bot's character; undefined (共字君 itself) for the default or a deleted bot. */
export function useBotCostume(id: string | undefined) {
  const role = useWorkspace((s) => s.bots.find((b) => b.id === id)?.avatar)
  return role && role !== 'role-gong' ? roleCostume(role) : undefined
}

type BotAvatarProps = Omit<AvatarProps, 'src' | 'shape'> & { id?: string | null }

/** A bot's role looked up by id, else by (unique) name, moving while it runs; deleted bots fall back to initials. */
export function BotAvatar({ id, name, ...rest }: BotAvatarProps) {
  const bot = useWorkspace((s) => s.bots.find((b) => (id ? b.id === id : b.name === name)))
  return (
    <Avatar
      name={name}
      shape="square"
      src={bot ? avatarSrc(bot.avatar, bot.presence === 'running') : undefined}
      {...rest}
    />
  )
}

export const roleHint = (k: RoleKey) => `${ROLES[k].name}：${ROLES[k].line}`

/** Every bot plays a character: 共字君 unless the creator picks one of the twelve personalities. */
export function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: RoleKey
  onChange: (v: RoleKey) => void
  disabled?: boolean
}) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label="角色" className="role-picker">
      {BOT_AVATARS.map((k) => {
        const r = ROLES[k]
        return (
          <label key={k} className="role-card" title={r.line}>
            <input
              type="radio"
              name={name}
              aria-label={`${r.name} · ${r.mix}`}
              checked={value === k}
              disabled={disabled}
              onChange={() => onChange(k)}
            />
            <span className="role-card__art">
              <img className="role-card__still" src={avatarSrc(k)} alt="" />
              <img className="role-card__live" src={avatarSrc(k, true)} alt="" />
            </span>
            <span className="role-card__name">{r.name}</span>
            <span className="role-card__title">
              {r.mix.split(' × ').map((t) => (
                <span key={t}>{t}</span>
              ))}
            </span>
          </label>
        )
      })}
    </div>
  )
}
