import { type GroupDto, type GroupTabDto, MAX_GROUP_TABS } from '@gonggong/protocol'
import { type DragEvent, useEffect, useRef, useState } from 'react'
import { tabKey, useWorkbench, type WorkbenchTab } from '../../app/workbench'
import { t } from '../../i18n'
import { copyText } from '../../lib/clipboard'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import {
  ConfirmActionDialog,
  ContextMenu,
  Icon,
  type IconName,
  MenuButton,
  type MenuItem,
  Presence,
  toast,
} from '../../ui'
import { GroupWorksTab } from '../artifacts/GroupWorks'
import { useGroupArtifacts } from '../artifacts/groupArtifacts'
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
            ? { kind: 'git', botId: x.botId }
            : null
  return w ? tabKey(w) : null
}

/**
 * 群标签栏 under the group header (飞书-style): 消息 first, then the group's shared tabs, then ＋. A click opens the
 * tab in the workbench (⌘/Ctrl-click or the context menu: a new browser tab); drag to reorder.
 */
export function GroupTabBar({ group, readOnly = false }: { group: GroupDto; readOnly?: boolean }) {
  const known = useGroupTabs(group.id)
  const works = useGroupArtifacts(group.id)
  const tabs = known ?? []
  const shown = useWorkbench((s) =>
    s.open && s.groupId === group.id ? (s.benches[group.id]?.active ?? null) : null,
  )
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<GroupTabDto | null>(null)
  const [deleting, setDeleting] = useState<GroupTabDto | null>(null)
  const dragging = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false })
  // biome-ignore lint/correctness/useExhaustiveDependencies: more tabs widen the content, not the observed box
  useEffect(() => {
    const el = list.current
    if (!el) return
    const measure = () => {
      const overflow = el.scrollWidth > el.clientWidth + 1
      const left = overflow && el.scrollLeft > 1
      const right = overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((p) =>
        p.overflow === overflow && p.left === left && p.right === right ? p : { overflow, left, right },
      )
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
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
        void copyText(new URL(href, location.href).href).then(
          () => toast({ type: 'success', message: t('已复制链接') }),
          () => toast({ type: 'error', message: t('复制失败') }),
        )
    } else if (value === 'rename' && !readOnly) setRenaming(tab)
    else if (value === 'delete' && !readOnly) setDeleting(tab)
  }
  const tabMenuItems = (tab: GroupTabDto, prefix = ''): MenuItem[] => {
    const href = tabHref(group.id, tab)
    return [
      { label: t('打开'), value: `${prefix}open` },
      { label: t('在新标签页打开'), value: `${prefix}external`, disabled: !href },
      { label: t('复制链接'), value: `${prefix}copy`, disabled: !href },
      ...(readOnly
        ? []
        : [
            { separator: true as const },
            { label: t('重命名'), value: `${prefix}rename` },
            { label: t('删除标签#tab'), value: `${prefix}delete`, destructive: true },
          ]),
    ]
  }
  const drop = (e: DragEvent, to: number) => {
    const from = dragging.current
    dragging.current = null
    if (readOnly || from === null || from === to) return
    e.preventDefault()
    const ids = tabs.map((x) => x.id)
    const [moved] = ids.splice(from, 1)
    if (moved) ids.splice(to, 0, moved)
    groupTabsApi.reorder(group.id, ids).catch(toastError)
  }

  if (!known || (!tabs.length && !works.length)) return null

  return (
    <nav className="gtabs" aria-label={t('群标签栏')}>
      <div
        ref={list}
        className={cx(
          'gtabs__list',
          edges.left && 'gtabs__list--fade-left',
          edges.right && 'gtabs__list--fade-right',
        )}
      >
        <span className="gtab gtab--current" aria-current="page">
          <Icon name="message" size={13} />
          <span className="gtab__title">{t('消息')}</span>
        </span>
        <GroupWorksTab groupId={group.id} />
        {tabs.map((tab, index) => {
          const href = tabHref(group.id, tab)
          const key = benchKey(tab)
          return (
            <ContextMenu
              key={tab.id}
              className="gtab__ctx"
              items={tabMenuItems(tab)}
              onSelect={(v) => onMenu(v, tab)}
            >
              <button
                type="button"
                draggable={!readOnly}
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
      {edges.overflow ? (
        <MenuButton
          aria-label={t('更多标签')}
          title={t('更多标签')}
          className="gtabs__more"
          align="end"
          portal
          items={tabs.map((x) => ({
            value: x.id,
            label: x.stale ? t('{title}（已失效）', { title: x.title }) : x.title,
          }))}
          onSelect={(id) => {
            const tab = tabs.find((x) => x.id === id)
            if (tab) open(tab, false)
          }}
        >
          {t('更多')}
          <Icon name="chevron-down" size={11} weight={1.8} />
        </MenuButton>
      ) : null}
      {!readOnly && tabs.length ? (
        <MenuButton
          aria-label={t('管理标签')}
          title={t('管理标签')}
          className="gtabs__manage"
          align="end"
          portal
          items={tabs.map((tab) => ({
            value: `tab:${tab.id}`,
            label: tab.stale ? t('{title}（已失效）', { title: tab.title }) : tab.title,
            submenu: tabMenuItems(tab, `${tab.id}:`),
          }))}
          onSelect={(v) => {
            const sep = v.lastIndexOf(':')
            if (sep < 0) return
            const tab = tabs.find((x) => x.id === v.slice(0, sep))
            if (tab) onMenu(v.slice(sep + 1), tab)
          }}
        >
          <Icon name="more" size={14} weight={2.2} />
        </MenuButton>
      ) : null}
      {!readOnly ? (
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
      ) : null}
      <Presence>{adding ? <AddTabDialog group={group} onClose={() => setAdding(false)} /> : null}</Presence>
      <Presence>
        {renaming ? (
          <RenameTabDialog groupId={group.id} tab={renaming} onClose={() => setRenaming(null)} />
        ) : null}
      </Presence>
      <Presence>
        {deleting ? (
          <ConfirmActionDialog
            title={t('删除标签「{title}」？', { title: deleting.title })}
            message={t('所有群成员顶部标签栏将移除该入口，原内容本身不会被删除。')}
            consequences={[t('需要时可随时重新添加该标签')]}
            label={t('删除')}
            done={t('已删除标签')}
            run={() => groupTabsApi.remove(group.id, deleting.id)}
            onClose={() => setDeleting(null)}
          />
        ) : null}
      </Presence>
    </nav>
  )
}
