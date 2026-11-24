import type { GroupDto, SearchResultDto } from '@gonggong/protocol'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import {
  Button,
  EmptyState,
  FileIcon,
  Icon,
  type IconName,
  listTime,
  NoResultsArt,
  Spinner,
  Tabs,
  useEscape,
  useFocusTrap,
} from '../../ui'
import { usePresenceOpen } from '../../ui/overlay'
import { usePresence } from '../../ui/presence'
import { GroupAvatar } from '../groups/GroupAvatar'
import './search.css'
import { t } from '../../i18n'

type Tab = SearchResultDto['kind']

const TABS: { value: Tab; label: string }[] = [
  { value: 'msg', label: t('消息') },
  { value: 'file', label: t('文件') },
  { value: 'run', label: t('运行') },
]
const ICON: Record<Tab, IconName> = { msg: 'bubble', file: 'doc-code', run: 'play' }
const DEBOUNCE_MS = 200
const MAX_CONVERSATIONS = 5
const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Conversations whose name (a DM's is its bot's) contains every term, matched locally as you type;
 * before any typing, the latest active ones other than the open one, as a quick switcher.
 */
const matchConversations = (groups: GroupDto[], query: string, open: string) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const list = terms.length
    ? groups.filter((g) => terms.every((w) => g.name.toLowerCase().includes(w)))
    : groups
        .filter((g) => `/g/${g.id}` !== open)
        .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
  return list.slice(0, MAX_CONVERSATIONS)
}

const hrefOf = (r: SearchResultDto) => {
  const q = new URLSearchParams()
  // A thread reply opens in its thread (plan 话题).
  if (r.kind === 'msg' && r.threadRootId) q.set('thread', r.threadRootId)
  if (r.kind === 'msg' && r.messageId) q.set('msg', r.messageId)
  if (r.kind !== 'msg' && r.runId) q.set('run', r.runId)
  if (r.kind === 'file') q.set('file', r.title)
  return `/g/${r.groupId}${q.size ? `?${q}` : ''}`
}

/** Snippets are flattened to one line, so block markers can sit anywhere after a space. */
const plainText = (s: string) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)(?:#{1,6}|>)\s+/g, '$1')
    .replace(/^(?:…)?\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\*\*|__|~~|`+/g, '')

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!terms.length) return text
  // A capturing split puts the matches at odd indices.
  return text.split(new RegExp(`(${terms.join('|')})`, 'gi')).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and rebuilt on every query
    i % 2 ? <mark key={i}>{part}</mark> : part,
  )
}

/** ⌘K overlay (Web 对话.dc.html `ovSearch`): my conversations by name, then messages, files and runs of my groups. */
export function SearchOverlay({ open = true, onClose }: { open?: boolean; onClose: () => void }) {
  const presenceOpen = usePresenceOpen()
  const visible = open && presenceOpen
  const presence = usePresence(visible)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const listId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const composingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('msg')
  const [attempt, setAttempt] = useState(0)
  /** Results tagged with the query they answer, so "no results" never shows for a pending query. */
  const [found, setFound] = useState<{ key: string; list: SearchResultDto[]; failed: boolean }>({
    key: '',
    list: [],
    failed: false,
  })
  const [active, setActive] = useState(0)
  const trimmed = q.trim()
  const key = trimmed && `${tab}:${trimmed}:${attempt}`
  const settled = !!key && found.key === key
  const results = settled ? found.list : []
  const groups = useWorkspace((s) => s.groups)
  const convs = !trimmed || tab === 'msg' ? matchConversations(groups, q, pathname) : []
  const count = convs.length + results.length
  const safeActive = count ? Math.min(active, count - 1) : -1
  useEscape(onClose, visible)

  const [prevVisible, setPrevVisible] = useState(visible)
  if (visible !== prevVisible) {
    setPrevVisible(visible)
    if (visible) {
      setQ('')
      setTab('msg')
      setAttempt(0)
      setFound({ key: '', list: [], failed: false })
      setActive(0)
    }
  }
  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  useEffect(() => () => clearTimeout(composingTimerRef.current), [])

  // Keep Tab inside real tab stops (excluding roving-tabindex tabs and tabIndex=-1 result options).
  useEffect(() => {
    const node = panelRef.current
    if (!visible || !node) return
    const onTab = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const items = [...node.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0)
      const first = items[0]
      const last = items.at(-1)
      const at = document.activeElement
      const inside = at instanceof HTMLElement && items.includes(at)
      if (!first || !last) e.preventDefault()
      else if (e.shiftKey && (at === first || at === node || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (at === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    node.addEventListener('keydown', onTab)
    return () => node.removeEventListener('keydown', onTab)
  }, [visible])
  useFocusTrap(panelRef, visible)

  useEffect(() => {
    if (!trimmed) return
    let live = true
    const done = (list: SearchResultDto[], failed = false) => {
      if (!live) return
      setFound({ key: `${tab}:${trimmed}:${attempt}`, list, failed })
      setActive(0)
    }
    const timer = setTimeout(() => {
      api.get<SearchResultDto[]>(`/search?${new URLSearchParams({ q: trimmed, tab })}`).then(
        (list) => done(list),
        () => done([], true),
      )
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [trimmed, tab, attempt])

  const switchTab = (next: Tab) => {
    setTab(next)
    setActive(0)
    // The tab is a parameter of the query; keyboard navigation stays in the input.
    inputRef.current?.focus()
  }
  const go = (href: string) => {
    onClose()
    navigate(href)
  }
  const hrefAt = (i: number) => {
    const g = convs[i]
    const r = results[i - convs.length]
    return g ? `/g/${g.id}` : r && hrefOf(r)
  }
  const optionId = (i: number) => `${listId}-${i}`
  const row = (key: string, i: number, href: string, children: ReactNode) => (
    <button
      key={key}
      id={optionId(i)}
      ref={i === safeActive ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={i === safeActive}
      className={cx('search__row', i === safeActive && 'search__row--active')}
      onMouseMove={() => setActive(i)}
      onClick={() => go(href)}
    >
      {children}
    </button>
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!count || composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (Math.min(i, count - 1) + step + count) % count)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const href = safeActive >= 0 ? hrefAt(safeActive) : undefined
      if (href) go(href)
    }
  }

  if (!presence.mounted) return null

  return (
    <>
      <div className="search__backdrop" data-state={presence.state} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="search"
        data-state={presence.state}
        aria-hidden={presence.state === 'closed' || undefined}
        inert={presence.state === 'closed' || undefined}
        onAnimationEnd={presence.onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label={t('搜索')}
        tabIndex={-1}
      >
        <div className="search__bar">
          <Icon name="search" size={15} weight={1.7} className="search__glass" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the overlay exists to type a query
            autoFocus
            ref={inputRef}
            className="search__input"
            placeholder={t('搜索会话、消息、文件、运行')}
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onCompositionStart={() => {
              clearTimeout(composingTimerRef.current)
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              // Safari fires Enter keydown right after compositionend with isComposing false.
              clearTimeout(composingTimerRef.current)
              composingTimerRef.current = setTimeout(() => {
                composingRef.current = false
              }, 0)
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="search__esc" aria-label={t('关闭搜索')} onClick={onClose}>
            <span className="search__esc-key">{t('esc 关闭')}</span>
            <span className="search__esc-tap">{t('取消')}</span>
          </button>
        </div>
        <div className="search__tabs">
          <Tabs size="sm" items={TABS} value={tab} onChange={switchTab} />
        </div>
        <div className="search__results" data-testid="search-results">
          {count ? (
            <div id={listId} role="listbox" aria-label={t('搜索结果')} className="search__list">
              {convs.length ? (
                <div className="search__section" role="presentation">
                  {trimmed ? t('会话#conversations') : t('最近')}
                </div>
              ) : null}
              {convs.map((g, i) =>
                row(
                  g.id,
                  i,
                  `/g/${g.id}`,
                  <>
                    <GroupAvatar group={g} size={20} />
                    <div className="search__text">
                      <div className="search__title">
                        <Highlight text={g.name} query={trimmed} />
                      </div>
                    </div>
                    <span className="search__time">{g.kind === 'dm' ? t('私聊') : t('群')}</span>
                  </>,
                ),
              )}
              {convs.length && results.length ? (
                <div className="search__section" role="presentation">
                  {TABS.find((x) => x.value === tab)?.label}
                </div>
              ) : null}
              {results.map((r, j) => {
                const icon = r.kind === 'run' && r.sub.includes('运行过程已过期') ? 'archive' : ICON[r.kind]
                const title = r.kind === 'file' ? r.title : plainText(r.title)
                return row(
                  `${r.groupId}:${r.messageId ?? r.runId}:${r.title}`,
                  convs.length + j,
                  hrefOf(r),
                  <>
                    {r.kind === 'file' ? (
                      <FileIcon name={r.title} size={18} />
                    ) : (
                      <Icon name={icon} size={15} className="search__icon" />
                    )}
                    <div className="search__text">
                      <div className={cx('search__title', r.kind === 'file' && 'search__title--mono')}>
                        <Highlight text={title} query={trimmed} />
                      </div>
                      <div className="search__sub">{r.sub}</div>
                    </div>
                    {r.at ? <span className="search__time">{listTime(r.at)}</span> : null}
                  </>,
                )
              })}
            </div>
          ) : null}
          {key && !settled ? (
            <div className="search__empty">
              <Spinner />
            </div>
          ) : settled && found.failed ? (
            <div className="search__empty">
              {t('搜索失败')}
              <button type="button" className="search__retry" onClick={() => setAttempt((a) => a + 1)}>
                {t('重试')}
              </button>
            </div>
          ) : settled && !count ? (
            <EmptyState
              compact
              title={t('没有匹配的结果')}
              description={
                tab === 'file'
                  ? t('文件搜索仅覆盖保留了改动详情的运行，过期运行的文件可在「运行」里按名称查找')
                  : undefined
              }
              action={
                tab === 'file' ? (
                  <Button size="small" onClick={() => switchTab('run')}>
                    {t('去「运行」里搜')}
                  </Button>
                ) : undefined
              }
              illustration={<NoResultsArt />}
            />
          ) : settled && tab === 'msg' && convs.length > 0 && !results.length ? (
            <div className="search__empty search__empty--note">{t('没有匹配的消息')}</div>
          ) : null}
        </div>
      </div>
    </>
  )
}
