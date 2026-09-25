import { type ReactNode, useState } from 'react'
import { Avatar, GlassButton, GlassGroup, type IconLike, type TagSpec, Tags } from './primitives'
import './header.css'

export interface ChatHeaderAction {
  icon: IconLike
  label: string
  onClick?: () => void
  active?: boolean
}

export interface ChatHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Rounded-square default avatar for groups and bots. */
  group?: boolean
  /** Replaces the default avatar; `null` hides it. */
  avatar?: ReactNode
  tags?: TagSpec[]
  actions?: ChatHeaderAction[]
  tabs?: { value: string; label: ReactNode }[]
  tab?: string
  defaultTab?: string
  onTabChange?: (value: string) => void
  trailing?: ReactNode
}

export function ChatHeader({
  title,
  subtitle,
  group,
  avatar,
  tags,
  actions,
  tabs = [],
  tab,
  defaultTab,
  onTabChange,
  trailing,
}: ChatHeaderProps) {
  const [own, setOwn] = useState(defaultTab ?? tabs[0]?.value)
  const current = tab ?? own
  return (
    <div className="pn-chathead">
      <div className="pn-chathead__bar">
        {avatar !== undefined ? (
          avatar
        ) : (
          <Avatar
            name={typeof title === 'string' ? title : ''}
            size={32}
            shape={group ? 'square' : 'circle'}
          />
        )}
        <div className="pn-chathead__titles">
          <div className="pn-chathead__title">
            <span>{title}</span>
            <Tags items={tags} />
          </div>
          {subtitle && <div className="pn-chathead__sub">{subtitle}</div>}
        </div>
        {actions && actions.length > 0 && (
          <GlassGroup>
            {actions.map((a) => (
              <GlassButton key={a.label} {...a} />
            ))}
          </GlassGroup>
        )}
        {trailing}
      </div>
      {tabs.length > 0 && (
        <div className="pn-chathead__tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              className="pn-chathead__tab"
              aria-selected={current === t.value}
              onClick={() => {
                setOwn(t.value)
                onTabChange?.(t.value)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
