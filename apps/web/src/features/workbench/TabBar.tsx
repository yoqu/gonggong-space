import { type DragEvent, useEffect, useRef } from 'react'
import { tabKey, useWorkbench, type WorkbenchTab } from '../../app/workbench'
import { cx } from '../../lib/cx'
import { ContextMenu, Icon, MenuButton, Spinner } from '../../ui'
import { TabLabel } from './TabContent'
import type { TabMeta } from './types'

function Mark({ meta }: { meta: TabMeta }) {
  switch (meta.status) {
    case 'running':
      return <Spinner size={12} />
    case 'online':
    case 'offline':
      return <span className="bench-tab__dot" data-status={meta.status} />
    case 'done':
      return <Icon name="checkmark-circle" size={13} className="bench-tab__done" />
    case 'failed':
      return <Icon name="xmark-circle" size={13} className="bench-tab__failed" />
    default:
      return <Icon name={meta.icon} size={13} />
  }
}

/** Workbench tabs: click to show, middle-click or ✕ to close, drag to reorder, right-click for more. */
export function TabBar({
  tabs,
  active,
  live,
}: {
  tabs: WorkbenchTab[]
  active: string | null
  /** Web tabs whose frame is mounted; the others are asleep. */
  live: Set<string>
}) {
  const { activate, closeTab, closeOthers, reorder } = useWorkbench.getState()
  const list = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever another tab becomes active
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const onMenu = (value: string, key: string, index: number) => {
    if (value === 'close') closeTab(key)
    else if (value === 'others') closeOthers(key)
    else for (const t of tabs.slice(index + 1)) closeTab(tabKey(t))
  }

  return (
    <div className="bench-tabs">
      <div ref={list} role="tablist" aria-label="标签页" className="bench-tabs__list">
        {tabs.map((tab, index) => {
          const key = tabKey(tab)
          const selected = key === active
          const drop = (e: DragEvent) => {
            const from = dragging.current
            dragging.current = null
            if (from === null) return
            e.preventDefault()
            if (from !== index) reorder(from, index)
          }
          return (
            <TabLabel key={key} tab={tab}>
              {(meta) => (
                <ContextMenu
                  className="bench-tab__ctx"
                  items={[
                    { label: '关闭', value: 'close' },
                    { label: '关闭其他标签页', value: 'others', disabled: tabs.length < 2 },
                    { label: '关闭右侧标签页', value: 'right', disabled: index === tabs.length - 1 },
                  ]}
                  onSelect={(v) => onMenu(v, key, index)}
                >
                  <div
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    title={meta.title}
                    draggable
                    className={cx('bench-tab', selected && 'bench-tab--active')}
                    onClick={() => activate(key)}
                    onMouseDown={(e) => {
                      // Middle button would start autoscroll.
                      if (e.button === 1) e.preventDefault()
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) closeTab(key)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        activate(key)
                      } else if (e.key === 'Delete') closeTab(key)
                    }}
                    onDragStart={(e) => {
                      dragging.current = index
                      e.dataTransfer?.setData('text/plain', key)
                    }}
                    onDragOver={(e) => {
                      if (dragging.current !== null) e.preventDefault()
                    }}
                    onDrop={drop}
                    onDragEnd={() => {
                      dragging.current = null
                    }}
                  >
                    <span className="bench-tab__icon">
                      <Mark meta={meta} />
                    </span>
                    <span className="bench-tab__title">{meta.title}</span>
                    {key.startsWith('web:') && !live.has(key) ? (
                      <Icon name="moon" size={11} label="休眠" className="bench-tab__sleep" />
                    ) : null}
                    <button
                      type="button"
                      tabIndex={-1}
                      className="bench-tab__close"
                      aria-label={`关闭 ${meta.title}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(key)
                      }}
                    >
                      <Icon name="xmark" size={10} weight={2} />
                    </button>
                  </div>
                </ContextMenu>
              )}
            </TabLabel>
          )
        })}
      </div>
      <MenuButton
        aria-label="全部标签页"
        title="全部标签页"
        className="bench__btn"
        align="end"
        items={tabs.map((t) => ({
          value: tabKey(t),
          label: <TabLabel tab={t}>{(meta) => meta.title}</TabLabel>,
        }))}
        onSelect={activate}
      >
        <Icon name="chevron-down" size={12} weight={1.8} />
      </MenuButton>
    </div>
  )
}
