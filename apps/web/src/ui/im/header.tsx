import { type ReactElement, type ReactNode, useState } from 'react'
import { Avatar, Tag } from '../display'
import { Icon, type IconName } from '../icon'
import { ToolbarButton, ToolbarGroup } from '../toolbar'
import type { TagSpec } from './types'
import './header.css'

export interface ChatHeaderAction {
  icon: IconName | ReactElement
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
  /** At most 4 glass capsule buttons. */
  actions?: ChatHeaderAction[]
  tabs?: { value: string; label: ReactNode }[]
  tab?: string
  defaultTab?: string
  onTabChange?: (value: string) => void
  trailing?: ReactNode
  /** Shows a「返回」chevron before the avatar (single-column mobile layout). */
  onBack?: () => void
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
  onBack,
}: ChatHeaderProps) {
  const [own, setOwn] = useState(defaultTab ?? tabs[0]?.value)
  const current = tab ?? own
  return (
    <header className="pn-chathead">
      <div className="pn-chathead__bar">
        {onBack ? (
          <button type="button" className="pn-chathead__back" aria-label="返回" onClick={onBack}>
            <Icon name="chevron-left" size={20} weight={1.8} />
          </button>
        ) : null}
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
            <h1>{title}</h1>
            {tags?.map((t) => (
              <Tag key={t.label} tone={t.tone}>
                {t.label}
              </Tag>
            ))}
          </div>
          {subtitle && <div className="pn-chathead__sub">{subtitle}</div>}
        </div>
        {actions && actions.length > 0 && (
          <ToolbarGroup>
            {actions.map((a) => (
              <ToolbarButton key={a.label} {...a} />
            ))}
          </ToolbarGroup>
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
    </header>
  )
}
