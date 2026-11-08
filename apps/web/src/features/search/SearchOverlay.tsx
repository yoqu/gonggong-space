import type { GroupDto, SearchResultDto } from '@gonggong/protocol'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import {
  EmptyState,
  FileIcon,
  Icon,
  type IconName,
  listTime,
  NoResultsArt,
  Spinner,
  Tabs,
  useEscape,
} from '../../ui'
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

/** Conversations whose name (a DM's is its bot's) contains every term, matched locally as you type. */
const matchConversations = (groups: GroupDto[], query: string) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return groups
    .filter((g) => terms.every((w) => g.name.toLowerCase().includes(w)))
    .slice(0, MAX_CONVERSATIONS)
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
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const listId = useId()
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
  const key = q.trim() && `${tab}:${q.trim()}:${attempt}`
  const settled = !!key && found.key === key
  const results = settled ? found.list : []
  const groups = useWorkspace((s) => s.groups)
  const convs = matchConversations(groups, q)
  const count = convs.length + results.length
  useEscape(onClose)

  useEffect(() => {
    const text = q.trim()
    if (!text) return
    let live = true
    const done = (list: SearchResultDto[], failed = false) => {
      if (!live) return
      setFound({ key: `${tab}:${text}:${attempt}`, list, failed })
      setActive(0)
    }
    const timer = setTimeout(() => {
      api.get<SearchResultDto[]>(`/search?${new URLSearchParams({ q: text, tab })}`).then(
        (list) => done(list),
        () => done([], true),
      )
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, tab, attempt])

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
      ref={i === active ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={i === active}
      className={cx('search__row', i === active && 'search__row--active')}
      onMouseMove={() => setActive(i)}
      onClick={() => go(href)}
    >
      {children}
    </button>
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!count || e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + count) % count)
    } else if (e.key === 'Enter') {
      const href = hrefAt(active)
      if (href) go(href)
    }
  }

  return (
    <>
      <div className="search__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="search" role="dialog" aria-label={t('搜索')}>
        <div className="search__bar">
          <Icon name="search" size={15} weight={1.7} className="search__glass" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the overlay exists to type a query
            autoFocus
            className="search__input"
            placeholder={t('搜索会话、消息、文件、运行')}
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-activedescendant={count ? optionId(active) : undefined}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          <span className="search__esc">{t('esc 关闭')}</span>
        </div>
        <div className="search__tabs">
          <Tabs size="sm" items={TABS} value={tab} onChange={setTab} />
        </div>
        <div className="search__results" data-testid="search-results">
          {count ? (
            <div id={listId} role="listbox" aria-label={t('搜索结果')} className="search__list">
              {convs.length ? (
                <div className="search__section" role="presentation">
                  {t('会话#conversations')}
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
                        <Highlight text={g.name} query={q.trim()} />
                      </div>
                    </div>
                    <span className="search__time">{g.kind === 'dm' ? t('私聊') : t('群聊')}</span>
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
                        <Highlight text={title} query={q.trim()} />
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
            <EmptyState compact title={t('没有匹配的结果')} illustration={<NoResultsArt />} />
          ) : null}
        </div>
      </div>
    </>
  )
}
