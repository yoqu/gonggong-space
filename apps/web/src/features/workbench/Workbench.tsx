import { useEffect, useRef } from 'react'
import { useBenchMode } from '../../app/ChatLayout'
import { useIsMobile } from '../../app/viewport'
import { liveFrames, tabKey, useBench, useWorkbench, type WorkbenchMode } from '../../app/workbench'
import { Icon, Popover, Tooltip } from '../../ui'
import { TabBar } from './TabBar'
import { TabContent, TabLabel } from './TabContent'
import './workbench.css'

const panel =
  'M3.8 3.5h10.4c.7 0 1.3.6 1.3 1.3v8.4c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3V4.8c0-.7.6-1.3 1.3-1.3z'

const MODES: { mode: WorkbenchMode; label: string; shortcut: string; d: string }[] = [
  { mode: 'split', label: '分栏', shortcut: '⌘\\', d: `${panel} M6.5 3.5v11 M9.5 3.5v11` },
  { mode: 'focus', label: '专注', shortcut: '⌘\\', d: `${panel} M4.8 3.5v11 M8.5 3.5v11` },
  { mode: 'full', label: '全屏', shortcut: '⌘⇧\\', d: 'M3 7V3h4 M11 3h4v4 M15 11v4h-4 M7 15H3v-4' },
]

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
    !!t.closest('[contenteditable]:not([contenteditable="false"])'))

/** ⌘\ 会话列表, ⌘⇧\ 全屏, ⌃Tab / ⌃⇧Tab 切换, ⌥W 关闭 (⌘W would close the browser tab). */
function useShortcuts(mode: WorkbenchMode) {
  const shown = useRef(mode)
  shown.current = mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target)) return
      const wb = useWorkbench.getState()
      const bench = wb.groupId ? wb.benches[wb.groupId] : undefined
      const keys = bench?.tabs.map(tabKey) ?? []
      const at = keys.indexOf(bench?.active ?? '')
      if ((e.metaKey || e.ctrlKey) && e.code === 'Backslash') {
        if (e.shiftKey) wb.setMode(wb.mode === 'full' ? wb.previous : 'full')
        else wb.setMode(shown.current === 'split' ? 'focus' : 'split')
      } else if (e.ctrlKey && e.key === 'Tab' && keys.length) {
        const next = keys[(at + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]
        if (next) wb.activate(next)
      } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyW' && bench?.active) {
        wb.closeTab(bench.active)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Under 768px: a full-screen page with one tab mounted at a time (memory); tabs are listed in a dropdown. */
function PhoneWorkbench() {
  const bench = useBench()
  const { activate, closeTab, setOpen } = useWorkbench.getState()
  const tab = bench.tabs.find((t) => tabKey(t) === bench.active) ?? bench.tabs[0]
  return (
    <section aria-label="工作台" className="bench bench--phone">
      <div className="bench__bar">
        <button type="button" className="bench__back" aria-label="返回聊天" onClick={() => setOpen(false)}>
          <Icon name="chevron-left" size={20} weight={1.8} />
        </button>
        <Popover
          aria-label="标签页"
          className="bench-switch"
          width="min(320px, calc(100vw - 32px))"
          trigger={
            <button type="button" className="bench-switch__trigger" aria-label="全部标签页">
              {tab ? (
                <TabLabel tab={tab}>
                  {(meta) => <span className="bench-switch__title">{meta.title}</span>}
                </TabLabel>
              ) : null}
              <Icon name="chevron-down" size={12} weight={1.8} />
            </button>
          }
        >
          {(close) =>
            bench.tabs.map((t) => {
              const key = tabKey(t)
              return (
                <TabLabel key={key} tab={t}>
                  {(meta) => (
                    <div className="bench-switch__row" aria-current={key === bench.active || undefined}>
                      <button
                        type="button"
                        className="bench-switch__pick"
                        onClick={() => {
                          activate(key)
                          close()
                        }}
                      >
                        <Icon name={meta.icon} size={14} />
                        <span className="bench-switch__title">{meta.title}</span>
                      </button>
                      <button
                        type="button"
                        className="bench__btn"
                        aria-label={`关闭 ${meta.title}`}
                        onClick={() => closeTab(key)}
                      >
                        <Icon name="xmark" size={11} weight={2} />
                      </button>
                    </div>
                  )}
                </TabLabel>
              )
            })
          }
        </Popover>
      </div>
      <div className="bench__body">
        {tab ? (
          <div key={tabKey(tab)} role="tabpanel" className="bench__pane">
            <TabContent tab={tab} active />
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** The chat page's workbench column: the current group's tabs, bodies kept mounted except sleeping web frames. */
export function Workbench() {
  return useIsMobile() ? <PhoneWorkbench /> : <DesktopWorkbench />
}

function DesktopWorkbench() {
  const bench = useBench()
  const mode = useBenchMode()
  const { setMode, setOpen } = useWorkbench.getState()
  const live = liveFrames(bench)
  useShortcuts(mode)
  return (
    <section aria-label="工作台" className="bench">
      <div className="bench__bar">
        <TabBar tabs={bench.tabs} active={bench.active} live={live} />
        <div className="bench__modes">
          <fieldset aria-label="布局" className="bench__seg">
            {MODES.map((m) => (
              <Tooltip key={m.mode} content={m.label} shortcut={m.shortcut} placement="bottom">
                <button
                  type="button"
                  className="bench__seg-item"
                  aria-label={m.label}
                  aria-pressed={mode === m.mode}
                  onClick={() => setMode(m.mode)}
                >
                  <svg
                    viewBox="0 0 18 18"
                    width={15}
                    height={15}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d={m.d} />
                  </svg>
                </button>
              </Tooltip>
            ))}
          </fieldset>
          <Tooltip content="隐藏工作台" placement="bottom">
            <button
              type="button"
              className="bench__btn"
              aria-label="隐藏工作台"
              onClick={() => setOpen(false)}
            >
              <Icon name="xmark" size={13} weight={1.8} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="bench__body">
        {bench.tabs.map((tab) => {
          const key = tabKey(tab)
          // A sleeping web tab renders nothing, so its iframe unmounts; activating it wakes (reloads) it.
          if (key.startsWith('web:') && !live.has(key)) return null
          return (
            <div key={key} role="tabpanel" className="bench__pane" hidden={key !== bench.active}>
              <TabContent tab={tab} active={key === bench.active} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
