import type { SearchResultDto } from '@gonggong/protocol'
import { type KeyboardEvent, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
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

const hrefOf = (r: SearchResultDto) => {
  const q = new URLSearchParams()
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

/** ⌘K overlay (Web 对话.dc.html `ovSearch`): messages, files and runs of my groups. */
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

  const go = (r: SearchResultDto) => {
    onClose()
    navigate(hrefOf(r))
  }
  const optionId = (i: number) => `${listId}-${i}`

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length || e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + results.length) % results.length)
    } else if (e.key === 'Enter') {
      const r = results[active]
      if (r) go(r)
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
            placeholder={t('搜索消息、文件、运行')}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={results.length ? optionId(active) : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="search__esc">{t('esc 关闭')}</span>
        </div>
        <div className="search__tabs">
          <Tabs size="sm" items={TABS} value={tab} onChange={setTab} />
        </div>
        <div className="search__results" data-testid="search-results">
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
          ) : settled && !results.length ? (
            <EmptyState compact title={t('没有匹配的结果')} illustration={<NoResultsArt />} />
          ) : null}
          {results.length ? (
            <div id={listId} role="listbox" aria-label={t('搜索结果')} className="search__list">
              {results.map((r, i) => {
                const icon = r.kind === 'run' && r.sub.includes('运行过程已过期') ? 'archive' : ICON[r.kind]
                const title = r.kind === 'file' ? r.title : plainText(r.title)
                return (
                  <button
                    key={`${r.groupId}:${r.messageId ?? r.runId}:${r.title}`}
                    id={optionId(i)}
                    ref={i === active ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    className={cx('search__row', i === active && 'search__row--active')}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(r)}
                  >
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
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
