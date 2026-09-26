import { type AgentKind, type BotAvatar as AvatarKey, BOT_AVATARS, type BotDto } from '@gonggong/protocol'
import { useId } from 'react'
import { useWorkspace } from '../../app/workspace'
import { Avatar, type AvatarProps } from '../../ui'

interface Art {
  label: string
  /** Gradient from top-left to bottom-right; `to` doubles as the ink of cut-outs. */
  from: string
  to: string
  glyph: (ink: string) => string
}

const W = '#fff'
const line = (w = 2.2) =>
  `fill="none" stroke="${W}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`

const ART: Record<AvatarKey, Art> = {
  'bot-dot': {
    label: '圆圆',
    from: '#4aa8ff',
    to: '#0062e0',
    glyph: (ink) =>
      `<path d="M20 12V8.5" ${line(1.8)}/><circle cx="20" cy="7.4" r="2" fill="${W}"/>` +
      `<rect x="10" y="12" width="20" height="17" rx="6.5" fill="${W}"/>` +
      `<circle cx="16" cy="20" r="2.3" fill="${ink}"/><circle cx="24" cy="20" r="2.3" fill="${ink}"/>` +
      `<path d="M17.6 25h4.8" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>`,
  },
  'bot-visor': {
    label: '护目',
    from: '#2fd6e0',
    to: '#00889c',
    glyph: (ink) =>
      `<rect x="6.5" y="17.5" width="3" height="6" rx="1.5" fill="${W}"/><rect x="30.5" y="17.5" width="3" height="6" rx="1.5" fill="${W}"/>` +
      `<rect x="9" y="10.5" width="22" height="19.5" rx="7.5" fill="${W}"/>` +
      `<rect x="12" y="16.5" width="16" height="6.5" rx="3.25" fill="${ink}"/>` +
      `<circle cx="16.3" cy="19.75" r="1.4" fill="#8ff7ff"/><circle cx="23.7" cy="19.75" r="1.4" fill="#8ff7ff"/>`,
  },
  'bot-cyclops': {
    label: '独眼',
    from: '#ffb54a',
    to: '#f06400',
    glyph: (ink) =>
      `<path d="M20 10.5V7" ${line(1.8)}/><circle cx="20" cy="6.2" r="1.9" fill="${W}"/>` +
      `<circle cx="20" cy="21.5" r="11" fill="${W}"/>` +
      `<circle cx="20" cy="20.5" r="5.4" fill="${ink}"/><circle cx="21.8" cy="18.7" r="1.9" fill="${W}"/>`,
  },
  'bot-bunny': {
    label: '兔耳',
    from: '#ff7a98',
    to: '#dc2461',
    glyph: (ink) =>
      `<rect x="12.5" y="4.5" width="4.4" height="12" rx="2.2" fill="${W}"/><rect x="23.1" y="4.5" width="4.4" height="12" rx="2.2" fill="${W}"/>` +
      `<rect x="9" y="13" width="22" height="17.5" rx="8.75" fill="${W}"/>` +
      `<path d="M14.3 22.2q2-2.8 4 0M21.7 22.2q2-2.8 4 0" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>` +
      `<circle cx="13.2" cy="25.3" r="1.5" fill="#ffc2d0"/><circle cx="26.8" cy="25.3" r="1.5" fill="#ffc2d0"/>`,
  },
  'bot-cat': {
    label: '猫耳',
    from: '#d58cff',
    to: '#8e2fd6',
    glyph: (ink) =>
      `<path d="M11.5 29.5Q9 29.5 9 27V14.5L12.8 8.5l4 4.2h6.4l4-4.2L31 14.5V27q0 2.5-2.5 2.5z" fill="${W}" stroke="${W}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<ellipse cx="15.5" cy="20.5" rx="1.9" ry="2.5" fill="${ink}"/><ellipse cx="24.5" cy="20.5" rx="1.9" ry="2.5" fill="${ink}"/>` +
      `<path d="M18.8 24.4h2.4L20 25.8z" fill="${ink}" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/>`,
  },
  'bot-screen': {
    label: '屏幕',
    from: '#8378ff',
    to: '#4336d9',
    glyph: (ink) =>
      `<rect x="8" y="9.5" width="24" height="17.5" rx="4.5" fill="${W}"/>` +
      `<rect x="11" y="12.5" width="18" height="11.5" rx="2.2" fill="${ink}"/>` +
      `<rect x="14.8" y="15.5" width="2.6" height="4.4" rx="1.3" fill="#7cf0c4"/><rect x="22.6" y="15.5" width="2.6" height="4.4" rx="1.3" fill="#7cf0c4"/>` +
      `<rect x="17.5" y="26.5" width="5" height="3.5" fill="${W}"/><rect x="13.5" y="29.3" width="13" height="2.6" rx="1.3" fill="${W}"/>`,
  },
  'bot-dome': {
    label: '圆顶',
    from: '#52d86c',
    to: '#1b9443',
    glyph: (ink) =>
      `<circle cx="20" cy="8.6" r="2.1" fill="${W}"/>` +
      `<path d="M9 27v-5.5a11 11 0 0 1 22 0V27a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" fill="${W}"/>` +
      `<ellipse cx="15.5" cy="20.5" rx="2" ry="2.7" fill="${ink}"/><ellipse cx="24.5" cy="20.5" rx="2" ry="2.7" fill="${ink}"/>` +
      `<circle cx="16.8" cy="26" r="1" fill="${ink}"/><circle cx="20" cy="26" r="1" fill="${ink}"/><circle cx="23.2" cy="26" r="1" fill="${ink}"/>`,
  },
  'bot-pixel': {
    label: '像素',
    from: '#ff8660',
    to: '#dc3a2c',
    glyph: (ink) =>
      `<rect x="19" y="6" width="2" height="4.5" fill="${W}"/><rect x="17.5" y="4.5" width="5" height="2.5" rx=".6" fill="${W}"/>` +
      `<rect x="10" y="10" width="20" height="20" rx="3.5" fill="${W}"/>` +
      `<rect x="14" y="15" width="3" height="3" fill="${ink}"/><rect x="23" y="15" width="3" height="3" fill="${ink}"/>` +
      `<path d="M14 21h2v2h8v-2h2v2h-2v2h-8v-2h-2z" fill="${ink}"/>`,
  },
  'agent-spark': {
    label: '星芒',
    from: '#ffa45a',
    to: '#d9531e',
    glyph: () =>
      `<path d="M18.5 9c1 7.5 4.5 11 12 12-7.5 1-11 4.5-12 12-1-7.5-4.5-11-12-12 7.5-1 11-4.5 12-12z" fill="${W}"/>` +
      `<path d="M30 6.8c.4 2.3 1.2 3.1 3.4 3.4-2.2.4-3 1.2-3.4 3.4-.4-2.2-1.2-3-3.4-3.4 2.2-.3 3-1.1 3.4-3.4z" fill="${W}" opacity=".85"/>`,
  },
  'agent-orbit': {
    label: '轨道',
    from: '#5cc9ff',
    to: '#0a6fe0',
    glyph: () =>
      `<ellipse cx="20" cy="20" rx="12.5" ry="5" transform="rotate(-30 20 20)" ${line(1.9)}/>` +
      `<ellipse cx="20" cy="20" rx="12.5" ry="5" transform="rotate(30 20 20)" ${line(1.9)} opacity=".7"/>` +
      `<circle cx="20" cy="20" r="3.3" fill="${W}"/><circle cx="30.8" cy="13.8" r="2" fill="${W}"/>`,
  },
  'agent-prism': {
    label: '棱镜',
    from: '#a88bff',
    to: '#5a2fd0',
    glyph: () =>
      `<path d="M20 8.5 8.5 29H20z" fill="${W}" opacity=".4"/>` +
      `<path d="M20 8.5 31.5 29h-23z" ${line()}/><path d="M20 8.5V29" ${line(1.6)} opacity=".8"/>`,
  },
  'agent-nodes': {
    label: '节点',
    from: '#3ad8c5',
    to: '#00958c',
    glyph: () =>
      `<path d="M12 13.5 28 12.5M12 13.5 20 27M28 12.5 20 27M28 12.5l2.5 13.5L20 27" ${line(1.8)}/>` +
      `<circle cx="12" cy="13.5" r="3.3" fill="${W}"/><circle cx="28" cy="12.5" r="3.3" fill="${W}"/>` +
      `<circle cx="20" cy="27" r="3.7" fill="${W}"/><circle cx="30.5" cy="26" r="2.1" fill="${W}" opacity=".85"/>`,
  },
  'agent-prompt': {
    label: '终端',
    from: '#5c616d',
    to: '#1f2228',
    glyph: () =>
      `<path d="m11 13.5 6.5 6.5-6.5 6.5" ${line(2.6)}/><path d="M20.5 26.5h9" ${line(2.6).replace(W, '#7cf0c4')}/>`,
  },
  'agent-compass': {
    label: '罗盘',
    from: '#43e0b8',
    to: '#00996f',
    glyph: () =>
      `<circle cx="20" cy="20" r="12" ${line(2)}/>` +
      `<path d="M20 11.5 23 20h-6z" fill="${W}"/><path d="M17 20h6l-3 8.5z" fill="${W}" opacity=".5"/>` +
      `<circle cx="20" cy="20" r="1.4" fill="${W}"/>`,
  },
  'agent-wave': {
    label: '声波',
    from: '#f06cff',
    to: '#a11bc6',
    glyph: () =>
      (
        [
          [10, 7],
          [14.5, 14],
          [19, 21],
          [23.5, 13],
          [28, 8],
        ] as const
      )
        .map(
          ([x, h]) =>
            `<rect x="${x - 1.4}" y="${20 - h / 2}" width="2.8" height="${h}" rx="1.4" fill="${W}"/>`,
        )
        .join(''),
  },
  'agent-hex': {
    label: '晶格',
    from: '#5b6cff',
    to: '#2231c4',
    glyph: () =>
      `<path d="m20 8.5 10 5.75v11.5L20 31.5l-10-5.75v-11.5z" ${line()}/>` +
      `<path d="m20 15.5 3.9 2.25v4.5L20 24.5l-3.9-2.25v-4.5z" fill="${W}"/>`,
  },
}

/** Shown until the owner picks one. */
export const AGENT_AVATAR: Record<AgentKind, AvatarKey> = { claude: 'agent-spark', codex: 'agent-prompt' }

const cache = new Map<AvatarKey, string>()

/** SVG data URI, so the avatar works anywhere `<Avatar src>` does. */
export function avatarSrc(key: AvatarKey) {
  let src = cache.get(key)
  if (!src) {
    const { from, to, glyph } = ART[key]
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      `<rect width="40" height="40" fill="url(#g)"/>${glyph(to)}</svg>`
    src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    cache.set(key, src)
  }
  return src
}

export const botAvatar = (b: Pick<BotDto, 'avatar' | 'agentKind'>) => b.avatar ?? AGENT_AVATAR[b.agentKind]

type BotAvatarProps = Omit<AvatarProps, 'src' | 'shape'> & { id?: string | null }

/** A bot's avatar looked up by id, else by (unique) name; deleted bots fall back to initials. */
export function BotAvatar({ id, name, ...rest }: BotAvatarProps) {
  const bot = useWorkspace((s) => s.bots.find((b) => (id ? b.id === id : b.name === name)))
  return <Avatar name={name} shape="square" src={bot ? avatarSrc(botAvatar(bot)) : undefined} {...rest} />
}

const GROUPS: { title: string; keys: AvatarKey[] }[] = [
  { title: '机器人', keys: BOT_AVATARS.filter((k) => k.startsWith('bot-')) },
  { title: '智能体', keys: BOT_AVATARS.filter((k) => k.startsWith('agent-')) },
]

export function AvatarPicker({
  value,
  onChange,
  disabled,
}: {
  value: AvatarKey
  onChange: (v: AvatarKey) => void
  disabled?: boolean
}) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label="头像" className="avatar-picker">
      {GROUPS.map((g) => (
        <div key={g.title} className="avatar-picker__group">
          <span className="avatar-picker__title">{g.title}</span>
          <div className="avatar-picker__grid">
            {g.keys.map((k) => (
              <label key={k} className="avatar-picker__item" title={ART[k].label}>
                <input
                  type="radio"
                  name={name}
                  aria-label={ART[k].label}
                  checked={value === k}
                  disabled={disabled}
                  onChange={() => onChange(k)}
                />
                <img src={avatarSrc(k)} alt="" />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
