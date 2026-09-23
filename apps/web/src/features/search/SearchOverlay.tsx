import type { SearchResultDto } from '@aiws/protocol'
import { Archive, FileCode, type LucideIcon, MessageSquare, Play, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../lib/api'
import { Tabs } from '../../ui'
import './search.css'

type Tab = SearchResultDto['kind']

const TABS: { value: Tab; label: string }[] = [
  { value: 'msg', label: '消息' },
  { value: 'file', label: '文件' },
  { value: 'run', label: '运行' },
]
const ICON: Record<Tab, LucideIcon> = { msg: MessageSquare, file: FileCode, run: Play }
const DEBOUNCE_MS = 200

const hrefOf = (r: SearchResultDto) => {
  const q = new URLSearchParams()
  if (r.kind !== 'msg' && r.runId) q.set('run', r.runId)
  if (r.kind === 'file') q.set('file', r.title)
  return `/g/${r.groupId}${q.size ? `?${q}` : ''}`
}

/** ⌘K overlay (Web 对话.dc.html `ovSearch`): messages, files and runs of my groups. */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('msg')
  /** Results tagged with the query they answer, so "no results" never shows for a pending query. */
  const [found, setFound] = useState<{ key: string; list: SearchResultDto[] }>({ key: '', list: [] })
  const key = q.trim() && `${tab}:${q.trim()}`
  const results = key ? found.list : []

  useEffect(() => {
    const text = q.trim()
    if (!text) return
    let live = true
    const done = (list: SearchResultDto[]) => live && setFound({ key: `${tab}:${text}`, list })
    const timer = setTimeout(() => {
      api
        .get<SearchResultDto[]>(`/search?${new URLSearchParams({ q: text, tab })}`)
        .then(done, () => done([]))
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="search__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="search" role="dialog" aria-label="搜索">
        <div className="search__bar">
          <Search size={15} color="var(--color-text-tertiary)" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the overlay exists to type a query
            autoFocus
            className="search__input"
            placeholder="搜索消息、文件、运行"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="search__esc">esc 关闭</span>
        </div>
        <div className="search__tabs">
          <Tabs size="sm" items={TABS} value={tab} onChange={setTab} />
        </div>
        <div className="search__results" data-testid="search-results">
          {key && found.key === key && !results.length ? (
            <div className="search__empty">没有匹配的结果</div>
          ) : null}
          {results.map((r) => {
            const Icon = r.kind === 'run' && r.sub.includes('运行过程已过期') ? Archive : ICON[r.kind]
            return (
              <button
                key={`${r.groupId}:${r.messageId ?? r.runId}:${r.title}`}
                type="button"
                className="search__row"
                onClick={() => {
                  onClose()
                  navigate(hrefOf(r))
                }}
              >
                <Icon size={14} className="search__icon" />
                <div className="search__text">
                  <div className={r.kind === 'file' ? 'search__title search__title--mono' : 'search__title'}>
                    {r.title}
                  </div>
                  <div className="search__sub">{r.sub}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
