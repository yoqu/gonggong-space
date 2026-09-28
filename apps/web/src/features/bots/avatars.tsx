import type { BotAvatar as RoleKey } from '@gonggong/protocol'
import { BOT_AVATARS } from '@gonggong/protocol'
import { useId } from 'react'
import { useWorkspace } from '../../app/workspace'
import { Avatar, type AvatarProps, type MascotCostume } from '../../ui'

interface Role {
  /** The function it plays in a software team. */
  title: string
  /** Its character name. */
  name: string
  /** The temperament the look is drawn from. */
  trait: string
  /** Tile gradient; `to` doubles as the ink of the face. */
  from: string
  to: string
  glyph: (ink: string) => string
  /** The live variant's signature move, keyed on classes in the glyph. */
  motion: string
  /** Eye centres, where the chat mascot draws its done / sleep / error faces; `skin` is the tile behind them. */
  eyes: [number, number][]
  skin?: string
}

const W = '#fff'
const stroke = (color: string, w: number) =>
  `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`
const eyes = (ink: string, y: number, dx = 4, rx = 1.9) =>
  `<ellipse cx="${20 - dx}" cy="${y}" rx="${rx}" ry="${rx * 1.2}" fill="${ink}"/><ellipse cx="${20 + dx}" cy="${y}" rx="${rx}" ry="${rx * 1.2}" fill="${ink}"/>`
const FILL_BOX = 'transform-box:fill-box;transform-origin:center'

export const ROLES: Record<RoleKey, Role> = {
  'role-gong': {
    eyes: [
      [18, 20.4],
      [22, 20.4],
    ],
    title: '默认角色',
    name: '共字君',
    trait: '品牌吉祥物，什么活都肯接，把大家托举在一起',
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
  },
  'role-pm': {
    eyes: [
      [16, 22],
      [24, 22],
    ],
    title: '产品经理',
    name: '点子',
    trait: '灵感不断，爱画蓝图，永远在想下一个需求',
    from: '#ffc23d',
    to: '#e8710a',
    glyph: (ink) =>
      `<g class="rays" ${stroke(W, 1.5)} opacity="0"><path d="M13.6 5.6l-1.8-1.3M26.4 5.6l1.8-1.3M13.2 9.6h-2.2M26.8 9.6h2.2"/></g>` +
      `<circle class="bulb" cx="20" cy="8" r="4.3" fill="${W}"/><path d="M18.5 8.2l1.5 1.5 1.5-1.5" ${stroke(ink, 1)}/>` +
      `<rect x="18" y="11.6" width="4" height="2.6" rx=".9" fill="${W}" opacity=".8"/>` +
      `<rect x="10" y="14.5" width="20" height="16.5" rx="7" fill="${W}"/>${eyes(ink, 22)}` +
      `<path d="M16.6 26.2q3.4 2.6 6.8 0" ${stroke(ink, 1.6)}/>`,
    motion:
      '.bulb{animation:bulb 1.4s ease-in-out infinite}@keyframes bulb{50%{fill:#fff27a}}' +
      '.rays{animation:rays 1.4s ease-in-out infinite}@keyframes rays{40%,70%{opacity:1}}',
  },
  'role-pjm': {
    eyes: [
      [15.4, 24.8],
      [24.6, 24.8],
    ],
    title: '项目经理',
    name: '准点',
    trait: '守时较真，盯紧里程碑，进度一格都不落',
    from: '#5edb7e',
    to: '#1a8f43',
    glyph: (ink) =>
      `<rect x="17" y="6.4" width="6" height="2.2" rx="1.1" fill="${W}"/><rect x="18.3" y="8" width="3.4" height="3.2" fill="${W}"/>` +
      `<rect x="27.4" y="10.4" width="3.2" height="2.4" rx="1" transform="rotate(42 29 11.6)" fill="${W}"/>` +
      `<circle cx="20" cy="22" r="10.5" fill="${W}"/>` +
      `<g fill="${ink}" opacity=".45"><circle cx="20" cy="13.4" r=".8"/><circle cx="28.6" cy="22" r=".8"/><circle cx="11.4" cy="22" r=".8"/></g>` +
      `<path class="hand" d="M20 20v-5.6" ${stroke(ink, 1.5)}/><circle cx="20" cy="20" r="1.2" fill="${ink}"/>` +
      `${eyes(ink, 24.8, 4.6, 1.7)}<path d="M18.4 28.6h3.2" ${stroke(ink, 1.4)}/>`,
    motion:
      '.hand{transform-origin:20px 20px;animation:tick 3s steps(12) infinite}@keyframes tick{to{transform:rotate(360deg)}}',
  },
  'role-designer': {
    eyes: [
      [16, 22.6],
      [24, 22.6],
    ],
    title: '设计师',
    name: '调色',
    trait: '感性敏锐，对一像素的偏差也不妥协',
    from: '#ff86b4',
    to: '#cf2a6c',
    glyph: (ink) =>
      `<rect x="10" y="15" width="20" height="16" rx="8" fill="${W}"/>` +
      `<g class="beret"><path d="M8.6 16.6c.4-5 6-8.2 12.4-8.2s11 3 10.5 7.5c-.3 1.5-3 1.6-11.4 1.6S8.4 18 8.6 16.6z" fill="${W}" stroke="${ink}" stroke-width="1.3"/>` +
      `<circle cx="21" cy="7.3" r="1.6" fill="${W}"/>` +
      `<circle class="dot d1" cx="15" cy="13.2" r="1.35" fill="#ffc400"/><circle class="dot d2" cx="19.5" cy="11.8" r="1.35" fill="#30c85e"/><circle class="dot d3" cx="24" cy="12.8" r="1.35" fill="#0a84ff"/></g>` +
      `<path d="M14.3 23.2q1.7-2.3 3.4 0M22.3 23.2q1.7-2.3 3.4 0" ${stroke(ink, 1.6)}/>` +
      `<circle cx="14" cy="26.2" r="1.4" fill="#ffc2d6"/><circle cx="26" cy="26.2" r="1.4" fill="#ffc2d6"/>` +
      `<path d="M18.5 26.8q1.5 1.2 3 0" ${stroke(ink, 1.4)}/>`,
    motion:
      `.beret{transform-origin:20px 16px;animation:tilt 1.6s ease-in-out infinite}@keyframes tilt{50%{transform:rotate(-7deg)}}` +
      `.dot{${FILL_BOX};animation:pop 1.2s ease-in-out infinite}.d2{animation-delay:.2s}.d3{animation-delay:.4s}` +
      '@keyframes pop{30%{transform:scale(1.5)}}',
  },
  'role-architect': {
    eyes: [
      [15.6, 20.8],
      [24.4, 20.8],
    ],
    title: '架构师',
    name: '蓝图',
    trait: '沉稳克制，先想清全局再落第一块砖',
    from: '#8d93ff',
    to: '#3a3ecf',
    glyph: (ink) =>
      `<path class="square" d="M23.4 11.2V4.6l6.6 6.6z" fill="${W}" opacity=".9"/>` +
      `<rect x="10.5" y="11" width="19" height="20" rx="3.5" fill="${W}"/>` +
      `<path d="M10.5 15.4h19M15 11v4.4M20 11v4.4M25 11v4.4" stroke="${ink}" stroke-width=".8" opacity=".22"/>` +
      `<g ${stroke(ink, 1.4)}><rect x="12.3" y="18.2" width="6.6" height="5.2" rx="1.2"/><rect x="21.1" y="18.2" width="6.6" height="5.2" rx="1.2"/><path d="M18.9 20.4h2.2"/></g>` +
      `<g class="pupils" fill="${ink}"><rect x="14.6" y="19.8" width="2" height="2" rx=".5"/><rect x="23.4" y="19.8" width="2" height="2" rx=".5"/></g>` +
      `<path d="M17.5 27.2h5" ${stroke(ink, 1.5)}/>`,
    motion:
      '.pupils{animation:scan 2.4s ease-in-out infinite}@keyframes scan{25%{transform:translateX(-1.4px)}75%{transform:translateX(1.4px)}}' +
      '.square{transform-origin:23.4px 11.2px;animation:swing 2.4s ease-in-out infinite}@keyframes swing{50%{transform:rotate(-12deg)}}',
  },
  'role-frontend': {
    eyes: [
      [15.5, 21.6],
      [24.5, 21.6],
    ],
    title: '前端工程师',
    name: '像素',
    trait: '手快追新，界面对不齐就浑身难受',
    from: '#5ab8ff',
    to: '#0a67d6',
    glyph: (ink) =>
      `<rect x="8" y="10.5" width="24" height="20" rx="4" fill="${W}"/>` +
      `<path d="M8 16v-1.5a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V16z" fill="${ink}" opacity=".16"/>` +
      `<circle cx="11.8" cy="13.3" r="1" fill="#ff5f57"/><circle cx="14.8" cy="13.3" r="1" fill="#febc2e"/><circle cx="17.8" cy="13.3" r="1" fill="#28c840"/>` +
      `${eyes(ink, 21.6, 4.5)}` +
      `<path d="M17.2 25.2l-1.6 1.5 1.6 1.5M22.8 25.2l1.6 1.5-1.6 1.5" ${stroke(ink, 1.3)}/>` +
      `<rect class="caret" x="19.4" y="25" width="1.2" height="3.4" rx=".5" fill="${ink}"/>`,
    motion: '.caret{animation:caret .9s steps(1) infinite}@keyframes caret{50%{opacity:0}}',
  },
  'role-backend': {
    eyes: [
      [15.6, 21.2],
      [24.4, 21.2],
    ],
    title: '后端工程师',
    name: '栈栈',
    trait: '话少靠谱，扛得住流量也扛得住锅',
    from: '#3ed6c4',
    to: '#0a8a80',
    glyph: (ink) =>
      `<path d="M8.5 19a11.5 11.5 0 0 1 23 0" ${stroke(W, 2.2)}/>` +
      `<rect x="6" y="17" width="4" height="8" rx="2" fill="${W}"/><rect x="30" y="17" width="4" height="8" rx="2" fill="${W}"/>` +
      `<rect x="10.5" y="11" width="19" height="20" rx="3" fill="${W}"/>` +
      `<path d="M10.5 17h19M10.5 25h19" stroke="${ink}" stroke-width="1.1" opacity=".3"/>` +
      `<g fill="#30c85e"><circle class="led l1" cx="13.6" cy="14" r="1"/><circle class="led l2" cx="16.6" cy="14" r="1"/><circle class="led l3" cx="19.6" cy="14" r="1"/></g>` +
      `<path d="M23 14h4" stroke="${ink}" stroke-width="1" opacity=".35"/>` +
      `<rect x="14" y="19.6" width="3.2" height="3.2" rx="1" fill="${ink}"/><rect x="22.8" y="19.6" width="3.2" height="3.2" rx="1" fill="${ink}"/>` +
      `<path d="M14 28h12" stroke="${ink}" stroke-width="1.1" stroke-dasharray="1.6 1.4" opacity=".35"/>`,
    motion:
      '.led{animation:led .9s steps(1) infinite}.l2{animation-delay:.3s}.l3{animation-delay:.6s}@keyframes led{50%{opacity:.2}}',
  },
  'role-qa': {
    eyes: [
      [15, 21.6],
      [24.5, 21],
    ],
    title: '测试工程师',
    name: '找茬',
    trait: '挑剔较真，专往边界和角落里找虫',
    from: '#ff8a66',
    to: '#d9362a',
    glyph: (ink) =>
      `<g class="bug"><ellipse cx="7.4" cy="33" rx="2" ry="1.6" fill="${W}"/><path d="M5.6 31.6l-1-1M9.2 31.6l1-1M5.4 34.2l-1 .8M9.4 34.2l1 .8" ${stroke(W, 0.9)}/></g>` +
      `<rect x="9.5" y="12" width="20" height="19" rx="8" fill="${W}"/>` +
      `<ellipse cx="15" cy="21.6" rx="1.8" ry="2.2" fill="${ink}"/><path d="M12.8 17.6l4.2.9" ${stroke(ink, 1.4)}/>` +
      `<path d="M14.6 27.2q2-1 4 0" ${stroke(ink, 1.4)}/>` +
      `<g class="lens"><path d="M27.6 24.4l4.6 4.6" ${stroke(W, 3)}/><circle cx="24.5" cy="21" r="4.6" fill="${W}" stroke="${ink}" stroke-width="1.6"/>` +
      `<circle cx="24.5" cy="21" r="2.4" fill="${ink}"/><circle cx="25.4" cy="20.1" r=".8" fill="${W}"/></g>`,
    motion:
      '.lens{transform-origin:24.5px 21px;animation:peer 2s ease-in-out infinite}@keyframes peer{25%{transform:translate(-1.2px,.6px) rotate(-8deg)}75%{transform:translate(1px,-.4px) rotate(6deg)}}' +
      '.bug{animation:crawl 2s ease-in-out infinite}@keyframes crawl{50%{transform:translateX(3px)}}',
  },
  'role-security': {
    eyes: [
      [16, 24],
      [24, 24],
    ],
    skin: '#27303f',
    title: '安全工程师',
    name: '守门',
    trait: '警惕多疑，默认不信任，每个口子都要查',
    from: '#7d8ba1',
    to: '#27303f',
    glyph: (ink) =>
      `<path d="M9 23a11 11 0 0 1 22 0v5a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" fill="${W}"/>` +
      `<path d="M20 12.6l3 1.1v2.4c0 1.8-1.3 3.1-3 3.7-1.7-.6-3-1.9-3-3.7v-2.4z" fill="${ink}"/>` +
      `<rect x="11" y="21.2" width="18" height="5.6" rx="2.8" fill="${ink}"/>` +
      `<rect class="scan" x="18.5" y="21.2" width="3" height="5.6" rx="1.3" fill="#7cf0c4"/>` +
      `<path d="M18 29.4h4" ${stroke(ink, 1.3)}/>`,
    motion:
      '.scan{animation:sweep 1.6s ease-in-out infinite alternate}@keyframes sweep{from{transform:translateX(-6px)}to{transform:translateX(6px)}}',
  },
  'role-devops': {
    eyes: [
      [16, 22.2],
      [24, 22.2],
    ],
    title: '运维工程师',
    name: '值守',
    trait: '夜猫子救火队，能自动化的绝不手动',
    from: '#b98aff',
    to: '#632bd0',
    glyph: (ink) =>
      `<g class="gear"><path d="M32.3 8.5L34.2 8.5M31.5 10.5L32.8 11.8M29.5 11.3L29.5 13.2M27.5 10.5L26.2 11.8M26.7 8.5L24.8 8.5M27.5 6.5L26.2 5.2M29.5 5.7L29.5 3.8M31.5 6.5L32.8 5.2" fill="none" stroke="${W}" stroke-width="2.3"/>` +
      `<circle cx="29.5" cy="8.5" r="3.3" fill="${W}"/><circle cx="29.5" cy="8.5" r="1.2" fill="${ink}"/></g>` +
      `<path d="M9 21a11 11 0 0 1 22 0" ${stroke(W, 2)}/>` +
      `<rect x="10" y="13" width="20" height="18" rx="8" fill="${W}"/>` +
      `<rect x="6.5" y="18.5" width="4" height="7" rx="2" fill="${W}"/><rect x="29.5" y="18.5" width="4" height="7" rx="2" fill="${W}"/>` +
      `<path d="M31.5 25c0 3.6-2.8 4.8-6.6 4.8" ${stroke(W, 1.5)}/><circle cx="24.6" cy="29.6" r="1.3" fill="${ink}"/>` +
      `<path d="M13.9 21.2h4.2a2.1 2.1 0 0 1-4.2 0zM21.9 21.2h4.2a2.1 2.1 0 0 1-4.2 0z" fill="${ink}"/>` +
      `<path d="M18.5 26.2h3" ${stroke(ink, 1.3)}/>`,
    motion:
      '.gear{transform-origin:29.5px 8.5px;animation:spin 2.4s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}',
  },
  'role-data': {
    eyes: [
      [15.9, 21.5],
      [24.1, 21.5],
    ],
    title: '数据工程师',
    name: '洞察',
    trait: '好奇又理性，一切结论都要数据说话',
    from: '#45d8f2',
    to: '#07839f',
    glyph: (ink) =>
      `<g fill="${W}"><rect class="bar b1" x="15.2" y="6.5" width="2.6" height="5" rx=".8"/><rect class="bar b2" x="18.7" y="4" width="2.6" height="7.5" rx=".8"/><rect class="bar b3" x="22.2" y="7.5" width="2.6" height="4" rx=".8"/></g>` +
      `<circle cx="20" cy="22" r="10.2" fill="${W}"/>` +
      `<g ${stroke(ink, 1.3)}><circle cx="15.9" cy="21.5" r="3.1"/><circle cx="24.1" cy="21.5" r="3.1"/><path d="M19 21.5h2"/></g>` +
      `<circle cx="15.9" cy="21.5" r="1.2" fill="${ink}"/><circle cx="24.1" cy="21.5" r="1.2" fill="${ink}"/>` +
      `<circle cx="20" cy="27.4" r="1.3" fill="${ink}"/>`,
    motion:
      '.bar{transform-box:fill-box;transform-origin:50% 100%;animation:grow 1.2s ease-in-out infinite}.b2{animation-delay:.2s}.b3{animation-delay:.4s}' +
      '@keyframes grow{50%{transform:scaleY(.45)}}',
  },
}

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

export function roleCostume(key: RoleKey): MascotCostume {
  const { from, to, eyes, skin } = ROLES[key]
  return {
    head: avatarSrc(key),
    headLive: avatarSrc(key, true),
    from,
    to,
    eyes,
    ink: skin ? '#7cf0c4' : to,
    skin,
  }
}

/** The chat mascot dressed as a bot's role; undefined (共字君 itself) for the default role or a deleted bot. */
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

export const roleHint = (k: RoleKey) => `${ROLES[k].name}：${ROLES[k].trait}`

/** Every bot plays a role: 共字君 unless the creator picks one of the ten functions. */
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
          <label key={k} className="role-card" title={r.trait}>
            <input
              type="radio"
              name={name}
              aria-label={`${r.name} · ${r.title}`}
              checked={value === k}
              disabled={disabled}
              onChange={() => onChange(k)}
            />
            <span className="role-card__art">
              <img className="role-card__still" src={avatarSrc(k)} alt="" />
              <img className="role-card__live" src={avatarSrc(k, true)} alt="" />
            </span>
            <span className="role-card__name">{r.name}</span>
            <span className="role-card__title">{r.title}</span>
          </label>
        )
      })}
    </div>
  )
}
