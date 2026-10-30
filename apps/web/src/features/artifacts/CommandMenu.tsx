import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Dialog, Icon, type MenuItem } from '../../ui'

/** One runnable entry of the command menu. */
export interface CommandEntry {
  group: string
  label: string
  value: string
  shortcut?: string
  disabled?: boolean
  /** Why it is disabled. */
  title?: string
}

/** Menu items as entries of `group`; a submenu's items go in as `parent › item`. */
export function entriesOf(group: string, items: MenuItem[], prefix = ''): CommandEntry[] {
  return items.flatMap((it): CommandEntry[] => {
    if (!('label' in it)) return []
    const label = `${prefix}${String(it.label)}`
    if (it.submenu) return entriesOf(group, it.submenu, `${label} › `)
    return [
      {
        group,
        label,
        value: it.value ?? label,
        ...(it.shortcut ? { shortcut: it.shortcut } : {}),
        ...(it.disabled ? { disabled: true } : {}),
        ...(it.title ? { title: it.title } : {}),
      },
    ]
  })
}

/** Every term of the query in the label or group, case-insensitively. */
export const matchEntries = (entries: CommandEntry[], query: string) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((e) => {
    const hay = `${e.label} ${e.group}`.toLowerCase()
    return terms.every((w) => hay.includes(w))
  })
}

/**
 * The canvas's command menu (Stitch ⌘K): every menu action, screen, tool and view command, searchable; ↑↓ move,
 * Enter runs, Esc closes. Disabled entries say why and do not run.
 */
export function CommandMenu({
  entries,
  onRun,
  onClose,
}: {
  entries: CommandEntry[]
  onRun: (value: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const shown = matchEntries(entries, query)
  const at = Math.min(active, shown.length - 1)
  const groups = [...new Set(shown.map((e) => e.group))]

  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the highlight
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView?.({ block: 'nearest' })
  }, [at, query])

  const run = (e: CommandEntry | undefined) => {
    if (!e || e.disabled) return
    onClose()
    onRun(e.value)
  }
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      if (shown.length) setActive((at + step + shown.length) % shown.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(shown[at])
    }
  }

  return (
    <Dialog open bare onClose={onClose} aria-label={t('命令菜单')}>
      <div className="ui-menu art-cmdk" data-testid="art-command-menu">
        <div className="art-cmdk__search">
          <Icon name="search" size={14} weight={1.7} />
          <input
            className="art-cmdk__input"
            role="combobox"
            aria-label={t('搜索命令')}
            aria-expanded
            aria-controls={id}
            aria-activedescendant={at >= 0 ? `${id}-${at}` : undefined}
            placeholder={t('搜索命令、屏幕、工具…')}
            value={query}
            // biome-ignore lint/a11y/noAutofocus: the menu opens to be typed in
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={keyDown}
          />
          <kbd className="ui-kbd">esc</kbd>
        </div>
        <div ref={list} id={id} className="art-cmdk__list" role="listbox" aria-label={t('命令')}>
          {shown.length ? (
            groups.map((g) => (
              <fieldset key={g} className="art-cmdk__group" aria-label={g}>
                <div className="ui-menu__header">{g}</div>
                {shown
                  .filter((e) => e.group === g)
                  .map((e) => {
                    const i = shown.indexOf(e)
                    return (
                      <div
                        key={`${e.group}:${e.value}`}
                        id={`${id}-${i}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={i === at}
                        aria-disabled={e.disabled || undefined}
                        title={e.title}
                        data-active={i === at ? '' : undefined}
                        className="ui-menu__item art-cmdk__item"
                        onMouseMove={() => i !== at && setActive(i)}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => run(e)}
                        onKeyDown={() => {}}
                      >
                        <span className="ui-menu__label">{e.label}</span>
                        {e.disabled && e.title ? <span className="art-cmdk__why">{e.title}</span> : null}
                        {e.shortcut ? <span className="ui-menu__shortcut">{e.shortcut}</span> : null}
                      </div>
                    )
                  })}
              </fieldset>
            ))
          ) : (
            <p className="art-cmdk__empty">{t('没有匹配的命令')}</p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
