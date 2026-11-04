import { type ReactNode, useId } from 'react'

/** Hand-drawn tiles for the platform's own plugins (by manifest name); others keep their category glyph. */
const ART: Record<string, { from: string; to: string; art: (id: string) => ReactNode }> = {
  // 幻灯片: a projected slide with a rising chart on a stand.
  slides: {
    from: '#ffb547',
    to: '#f2643a',
    art: (id) => (
      <>
        <rect x="8" y="10" width="24" height="16" rx="2.4" fill="#fff" />
        <rect x="8" y="10" width="24" height="3.2" rx="1.6" fill="#fff" opacity=".7" />
        <rect x="12" y="19" width="3" height="4" rx=".8" fill={`url(#${id})`} opacity=".55" />
        <rect x="17" y="16.5" width="3" height="6.5" rx=".8" fill={`url(#${id})`} opacity=".75" />
        <rect x="22" y="14" width="3" height="9" rx=".8" fill={`url(#${id})`} />
        <path d="M26.6 14.2l2.2-1.6" stroke={`url(#${id})`} strokeWidth="1.4" strokeLinecap="round" />
        <path
          d="M20 26v3.2M16 31.5l4-2.3 4 2.3"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </>
    ),
  },
  // 产品原型: a browser window with a phone screen in front and a pointer tapping it.
  'web-prototype': {
    from: '#5aa2ff',
    to: '#5b4cf0',
    art: (id) => (
      <>
        <rect x="7" y="9" width="22" height="16" rx="2.4" fill="#fff" opacity=".55" />
        <circle cx="9.8" cy="11.6" r=".9" fill="#fff" />
        <circle cx="12.4" cy="11.6" r=".9" fill="#fff" />
        <rect x="20" y="14" width="12" height="19" rx="2.6" fill="#fff" />
        <rect x="22.5" y="17.5" width="7" height="4" rx="1" fill={`url(#${id})`} opacity=".85" />
        <rect x="22.5" y="23" width="7" height="1.4" rx=".7" fill={`url(#${id})`} opacity=".45" />
        <rect x="22.5" y="25.6" width="4.6" height="1.4" rx=".7" fill={`url(#${id})`} opacity=".45" />
        <rect x="24.4" y="30.2" width="3.2" height="1" rx=".5" fill={`url(#${id})`} opacity=".4" />
        <path
          d="M12.5 19.5l5.6 2.1-2.4.9-.9 2.4z"
          fill="#fff"
          stroke="#fff"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </>
    ),
  },
}

export const hasOfficialIcon = (name: string | null | undefined) => !!name && name in ART

/** An official plugin's tile; `size` in px, the drawing scales with it. */
export function OfficialIcon({ name, size }: { name: string; size: number }) {
  const id = useId()
  const a = ART[name]
  if (!a) return null
  const bg = `${id}-bg`
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flex: 'none' }}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a.from} />
          <stop offset="1" stopColor={a.to} />
        </linearGradient>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a.from} />
          <stop offset="1" stopColor={a.to} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${bg})`} />
      <rect width="40" height="20" rx="11" fill="#fff" opacity=".12" />
      {a.art(id)}
    </svg>
  )
}
