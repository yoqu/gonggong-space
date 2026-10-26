import { type GroupDto, type GroupTabDto, MAX_GROUP_TABS } from '@gonggong/protocol'
import { type DragEvent, useEffect, useRef, useState } from 'react'
import { tabKey, useWorkbench, type WorkbenchTab } from '../../app/workbench'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { ContextMenu, Icon, type IconName, MenuButton, Presence, toast } from '../../ui'
import { fileIconName } from '../files/FileViewer'
import { AddTabDialog, RenameTabDialog } from './AddTabDialog'
import { groupTabsApi, openGroupTab, tabHref, useGroupTabs } from './store'
import './group-tabs.css'

const ENTRY_ICONS: Record<string, IconName> = {
  notice: 'megaphone',
  pins: 'pin',
  schedules: 'clock',
  'git-log': 'git-branch',
}

function TabIcon({ tab }: { tab: GroupTabDto }) {
  const [broken, setBroken] = useState(false)
  const x = tab.target
  if (x.kind === 'link' && x.icon && !broken)
    return (
      <img
        className="gtab__favicon"
        src={x.icon}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    )
  const name: IconName =
    x.kind === 'link'
      ? 'globe'
      : x.kind === 'knowledge'
        ? 'doc-text'
        : x.kind === 'file'
          ? fileIconName(x.path, '')
          : (ENTRY_ICONS[x.entry] ?? 'doc')
  return <Icon name={name} size={13} />
}

/** The workbench tab a group tab opens, to light it up while it is the one shown. */
function benchKey(tab: GroupTabDto): string | null {
  const x = tab.target
  const w: WorkbenchTab | null =
    x.kind === 'link'
      ? { kind: 'link', url: x.url, title: tab.title }
      : x.kind === 'knowledge'
        ? { kind: 'knowledge', knowledgeId: x.knowledgeId, title: tab.title }
        : x.kind === 'file'
          ? { kind: 'file', source: { botId: x.botId, path: x.path } }
          : x.entry === 'git-log' && x.botId
            ? { kind: 'git-log', botId: x.botId, ref: null, commit: null }
            : null
  return w ? tabKey(w) : null
}

/**
 * 群标签栏 under the group header (飞书-style): 消息 first, then the group's shared tabs, then ＋. A click opens the
 * tab in the workbench (⌘/Ctrl-click or the context menu: a new browser tab); drag to reorder.
 */
export function GroupTabBar({ group }: { group: GroupDto }) {
  const known = useGroupTabs(group.id)
  const tabs = known ?? []
  const shown = useWorkbench((s) =>
    s.open && s.groupId === group.id ? (s.benches[group.id]?.active ?? null) : null,
  )
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<GroupTabDto | null>(null)
  const dragging = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: more tabs widen the content, not the observed box
  useEffect(() => {
    const el = list.current
    if (!el) return
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabs.length])

  const open = (tab: GroupTabDto, external: boolean) => {
    const href = tabHref(group.id, tab)
    if (external && href) window.open(href, '_blank', 'noopener,noreferrer')
    else openGroupTab(tab)
  }
  const onMenu = (value: string, tab: GroupTabDto) => {
    if (value === 'open') open(tab, false)
    else if (value === 'external') open(tab, true)
    else if (value === 'copy') {
      const href = tabHref(group.id, tab)
      if (href)
        void navigator.clipboard
          .writeText(new URL(href, location.href).href)
          .then(() => toast({ type: 'success', message: t('已复制链接') }))
    } else if (value === 'rename') setRenaming(tab)
    else if (value === 'delete') groupTabsApi.remove(group.id, tab.id).catch(toastError)
  }
  const drop = (e: DragEvent, to: number) => {
    const from = dragging.current
    dragging.current = null
    if (from === null || from === to) return
    e.preventDefault()
    const ids = tabs.map((x) => x.id)
    const [moved] = ids.splice(from, 1)
    if (moved) ids.splice(to, 0, moved)
    groupTabsApi.reorder(group.id, ids).catch(toastError)
  }

  if (!known || !tabs.length) return null

  return (
    <nav className="gtabs" aria-label={t('群标签栏')}>
      <div ref={list} className="gtabs__list">
        <span className="gtab gtab--current" aria-current="page">
          <Icon name="message" size={13} />
          <span className="gtab__title">{t('消息')}</span>
        </span>
        {tabs.map((tab, index) => {
          const href = tabHref(group.id, tab)
          const key = benchKey(tab)
          return (
            <ContextMenu
              key={tab.id}
              className="gtab__ctx"
              items={[
                { label: t('打开'), value: 'open' },
                { label: t('在新标签页打开'), value: 'external', disabled: !href },
                { label: t('复制链接'), value: 'copy', disabled: !href },
                { separator: true },
                { label: t('重命名'), value: 'rename' },
                { label: t('删除标签'), value: 'delete', destructive: true },
              ]}
              onSelect={(v) => onMenu(v, tab)}
            >
              <button
                type="button"
                draggable
                className={cx('gtab', key && key === shown && 'gtab--active', tab.stale && 'gtab--stale')}
                title={
                  tab.stale
                    ? t('{title}（已失效）', { title: tab.title })
                    : tab.target.kind === 'link'
                      ? `${tab.title}\n${tab.target.url}`
                      : tab.title
                }
                data-testid="group-tab"
                onClick={(e) => open(tab, e.metaKey || e.ctrlKey)}
                onAuxClick={(e) => {
                  if (e.button === 1 && href) open(tab, true)
                }}
                onDragStart={(e) => {
                  dragging.current = index
                  e.dataTransfer?.setData('text/plain', tab.title)
                }}
                onDragOver={(e) => {
                  if (dragging.current !== null) e.preventDefault()
                }}
                onDrop={(e) => drop(e, index)}
                onDragEnd={() => {
                  dragging.current = null
                }}
              >
                <TabIcon tab={tab} />
                <span className="gtab__title">{tab.title}</span>
                {tab.stale ? <span className="gtab__stale">{t('已失效')}</span> : null}
              </button>
            </ContextMenu>
          )
        })}
      </div>
      {overflow ? (
        <MenuButton
          aria-label={t('更多标签')}
          title={t('更多标签')}
          className="gtabs__more"
          align="end"
          items={tabs.map((x) => ({ value: x.id, label: x.title }))}
          onSelect={(id) => {
            const tab = tabs.find((x) => x.id === id)
            if (tab) open(tab, false)
          }}
        >
          {t('更多')}
          <Icon name="chevron-down" size={11} weight={1.8} />
        </MenuButton>
      ) : null}
      <button
        type="button"
        className="gtabs__add"
        aria-label={t('添加标签')}
        title={
          tabs.length >= MAX_GROUP_TABS ? t('本群最多 {n} 个标签', { n: MAX_GROUP_TABS }) : t('添加标签')
        }
        disabled={tabs.length >= MAX_GROUP_TABS}
        onClick={() => setAdding(true)}
      >
        <Icon name="plus" size={13} />
      </button>
      <Presence>
        {adding ? <AddTabDialog group={group} onClose={() => setAdding(false)} /> : null}
        {renaming ? (
          <RenameTabDialog groupId={group.id} tab={renaming} onClose={() => setRenaming(null)} />
        ) : null}
      </Presence>
    </nav>
  )
}
