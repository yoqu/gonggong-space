import type { DirListingDto, DirPlace } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { fullTime } from '../../lib/time'
import { Alert, Button, Dialog, Icon, type IconName, Input, SearchField, Select, Spinner } from '../../ui'
import './workspaces.css'

const parentOf = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return null
  // A root keeps its separator (`/`, `C:\`): a bare `C:` is not an absolute path on Windows.
  const parent = trimmed.slice(0, cut + 1)
  return /^([A-Za-z]:)?[\\/]$/.test(parent) ? parent : parent.slice(0, -1)
}
/** The root `path` lives on; compared case-insensitively since Windows drives are. */
const rootOf = (path: string, roots: string[]) =>
  roots.find((r) => path.toLowerCase().startsWith(r.toLowerCase())) ?? null
export const join = (dir: string, name: string) =>
  `${dir.replace(/[\\/]+$/, '')}${dir.includes('\\') ? '\\' : '/'}${name}`
const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path
const samePath = (a: string, b: string) => a.replace(/(.)[\\/]+$/, '$1') === b.replace(/(.)[\\/]+$/, '$1')

const PLACE_ICONS: Record<DirPlace['kind'], IconName> = {
  home: 'house',
  desktop: 'desktop',
  documents: 'doc',
  downloads: 'download',
  volume: 'hard-drive',
}
const placeLabel = (p: DirPlace) => {
  if (p.kind === 'desktop') return t('桌面')
  // Windows calls it 文档, macOS 文稿.
  if (p.kind === 'documents') return p.path.includes('\\') ? t('文档#folder') : t('文稿')
  if (p.kind === 'downloads') return t('下载#folder')
  return p.name
}

const RECENT_MAX = 5
const recentKey = (machineId: string) => `gg.dirpick.recent.${machineId}`
const readRecent = (machineId: string): string[] =>
  JSON.parse(localStorage.getItem(recentKey(machineId)) ?? '[]')

type Sort = { by: 'name' | 'modified'; desc: boolean }
const SORT_KEY = 'gg.dirpick.sort'
const readSort = (): Sort =>
  JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null') ?? { by: 'name', desc: false }
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
type Entry = DirListingDto['entries'][number]
const sorted = (entries: Entry[], { by, desc }: Sort) => {
  const sign = desc ? -1 : 1
  return [...entries].sort((a, b) => {
    if (by === 'name') return sign * byName(a.name, b.name)
    // Unknown times (null, or missing from older daemons) stay last whichever way.
    if (!a.modified || !b.modified) return (a.modified ? 0 : 1) - (b.modified ? 0 : 1)
    return sign * (a.modified - b.modified)
  })
}
const DEFAULT_FOLDER = t('未命名文件夹')
/** 共工's per-group workspaces (`~/.gonggong/workspaces/…`), deleted with their group's Bot or by storage cleanup. */
const inManaged = (path: string) => /[\\/]\.gonggong[\\/]workspaces([\\/]|$)/.test(path)
const MANAGED = t(
  '这是共工按群托管的工作区，原群删除 Bot 或清理空间时会被删掉。请把仓库克隆到其他目录（如 ~/code）再选择。',
)

/** Browse the machine's directories (via its daemon) and pick one as a workspace; `extra` adds other choices. */
export function DirPicker({
  machineId,
  title,
  start = null,
  hidden = false,
  managed = false,
  hint = t('进入具体项目目录后选择'),
  extra,
  onPick,
  onClose,
}: {
  machineId: string
  title: string
  start?: string | null
  /** List dot-directories too. */
  hidden?: boolean
  /** Managed workspaces can be picked (a terminal may open one; a workspace must not live in one). */
  managed?: boolean
  /** Shown where the listed directory cannot be picked (the home it starts at). */
  hint?: string
  extra?: ReactNode
  onPick: (path: string) => void
  onClose: () => void
}) {
  const [path, setPath] = useState<string | null>(start)
  const [typed, setTyped] = useState(start ?? '')
  const [dir, setDir] = useState<DirListingDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Kept across loads so the sidebar does not flicker while moving between folders.
  const [places, setPlaces] = useState<DirPlace[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(readSort)
  const [recent] = useState(() => readRecent(machineId))
  /** The new folder's name while its row is being edited. */
  const [draft, setDraft] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const draftRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setDir(null)
    setError(null)
    setQuery('')
    setDraft(null)
    const q = [path && `path=${encodeURIComponent(path)}`, hidden && 'hidden=1'].filter(Boolean).join('&')
    api
      .get<DirListingDto>(`/machines/${machineId}/dirs${q && `?${q}`}`)
      .then((d) => {
        if (!live) return
        setDir(d)
        setTyped(d.path)
        setPlaces(d.places ?? [])
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [machineId, path, hidden])

  const editing = draft !== null
  useEffect(() => {
    if (editing) draftRef.current?.select()
  }, [editing])

  const pick = (p: string) => {
    localStorage.setItem(
      recentKey(machineId),
      JSON.stringify([p, ...readRecent(machineId).filter((r) => r !== p)].slice(0, RECENT_MAX)),
    )
    onPick(p)
  }
  const sortBy = (by: Sort['by']) => {
    // A new column starts the way Finder does: names A→Z, newest first.
    const next = { by, desc: by === sort.by ? !sort.desc : by === 'modified' }
    setSort(next)
    localStorage.setItem(SORT_KEY, JSON.stringify(next))
  }
  const create = async () => {
    const name = draft?.trim()
    if (!dir || !name || creating) return
    setCreating(true)
    setDraftError(null)
    try {
      const made = await api.post<{ path: string }>(`/machines/${machineId}/dirs`, { parent: dir.path, name })
      setPath(made.path)
    } catch (e) {
      setDraftError(errorText(e))
    } finally {
      setCreating(false)
    }
  }

  const refused = dir && !managed && inManaged(dir.path) ? MANAGED : null
  const up = dir && parentOf(dir.path)
  const roots = dir?.roots ?? []
  const needle = query.trim().toLowerCase()
  const entries = dir ? sorted(dir.entries, sort).filter((e) => e.name.toLowerCase().includes(needle)) : []
  const sideItem = (key: string, icon: IconName, label: string, to: string) => (
    <button
      key={key}
      type="button"
      className="dirpick__place"
      aria-current={dir && samePath(dir.path, to) ? true : undefined}
      title={to}
      onClick={() => setPath(to)}
    >
      <Icon name={icon} size={14} className="dirpick__place-icon" />
      <span className="dirpick__name">{label}</span>
    </button>
  )
  const header = (by: Sort['by'], label: string) => (
    <button
      type="button"
      className={cx('dirpick__col', `dirpick__col--${by}`, sort.by === by && 'is-active')}
      aria-pressed={sort.by === by}
      onClick={() => sortBy(by)}
    >
      {label}
      {sort.by === by ? <Icon name={sort.desc ? 'chevron-down' : 'chevron-up'} size={11} /> : null}
    </button>
  )
  return (
    <Dialog
      open
      title={title}
      width={760}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            variant="primary"
            disabled={!dir || !!dir.unusable || !!refused}
            title={dir?.unusable ?? refused ?? undefined}
            onClick={() => dir && pick(dir.path)}
          >
            {t('选择此目录')}
          </Button>
        </>
      }
    >
      <div className="dirpick">
        {extra}
        <div className="dirpick__bar">
          <Button
            icon="arrow-turn-left-up"
            aria-label={t('上一级')}
            title={t('上一级')}
            disabled={!up}
            onClick={() => up && setPath(up)}
          />
          {roots.length > 1 && !places.length ? (
            <Select
              label={t('磁盘')}
              options={roots.map((r) => ({ value: r, label: r.replace(/[\\/]$/, '') }))}
              value={dir && rootOf(dir.path, roots)}
              onChange={setPath}
            />
          ) : null}
          <form
            className="dirpick__path"
            onSubmit={(e) => {
              e.preventDefault()
              if (typed.trim()) setPath(typed.trim())
            }}
          >
            <Input
              size="sm"
              mono
              value={typed}
              aria-label={t('目录路径')}
              onChange={(e) => setTyped(e.target.value)}
            />
          </form>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape from the search input clears it before it closes the dialog */}
          <div
            className="dirpick__search"
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || !query) return
              e.preventDefault()
              setQuery('')
            }}
          >
            <SearchField value={query} onChange={setQuery} aria-label={t('搜索文件夹')} />
          </div>
          {dir?.canCreate ? (
            <Button
              icon="folder-plus"
              aria-label={t('新建文件夹')}
              title={t('新建文件夹')}
              disabled={editing}
              onClick={() => {
                setDraftError(null)
                setDraft(DEFAULT_FOLDER)
              }}
            />
          ) : null}
        </div>
        <div className="dirpick__body">
          {places.length || recent.length ? (
            <aside className="dirpick__side">
              {places.length ? (
                <nav className="dirpick__group" aria-label={t('位置#places')}>
                  <div className="dirpick__group-title">{t('位置#places')}</div>
                  {places.map((p) => sideItem(p.path, PLACE_ICONS[p.kind], placeLabel(p), p.path))}
                </nav>
              ) : null}
              {recent.length ? (
                <nav className="dirpick__group" aria-label={t('最近使用')}>
                  <div className="dirpick__group-title">{t('最近使用')}</div>
                  {recent.map((p) => sideItem(p, 'clock', baseName(p), p))}
                </nav>
              ) : null}
            </aside>
          ) : null}
          <div className="dirpick__main">
            {dir?.git ? (
              <div className="dirpick__git" data-testid="dirpick-git">
                <Icon name="git-branch" size={13} />
                <span>{t('git 仓库 · {branch}', { branch: dir.git.branch ?? t('游离 HEAD') })}</span>
                <span className="dirpick__remote">{dir.git.remotes[0] ?? t('无 remote')}</span>
              </div>
            ) : null}
            {/* Browsing starts at home, which is never selectable itself: guide rather than warn. */}
            {dir?.unusable ? <p className="dirpick__hint">{hint}</p> : null}
            {refused ? <Alert variant="warning" title={refused} /> : null}
            {error ? <Alert variant="error" title={error} /> : null}
            <div className="dirpick__table">
              {dir?.entries.length || editing ? (
                <div className="dirpick__head">
                  {header('name', t('名称'))}
                  {header('modified', t('修改时间'))}
                </div>
              ) : null}
              <div className="dirpick__list">
                {editing ? (
                  <div className="dirpick__new">
                    <div className="dirpick__item dirpick__item--edit">
                      <Icon name="folder" size={14} className="dirpick__icon" />
                      <Input
                        ref={draftRef}
                        size="sm"
                        autoFocus
                        value={draft}
                        readOnly={creating}
                        invalid={!!draftError}
                        aria-label={t('文件夹名称')}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void create()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setDraft(null)
                          }
                        }}
                      />
                    </div>
                    {draftError ? <div className="dirpick__error">{draftError}</div> : null}
                  </div>
                ) : null}
                {!dir && !error ? (
                  <div className="dirpick__loading">
                    <Spinner />
                  </div>
                ) : entries.length ? (
                  entries.map((e) => (
                    <button
                      key={e.name}
                      type="button"
                      className="dirpick__item"
                      data-testid="dirpick-item"
                      onClick={() => dir && setPath(join(dir.path, e.name))}
                    >
                      <Icon name="folder" size={14} className="dirpick__icon" />
                      <span className="dirpick__name">{e.name}</span>
                      {e.git ? <span className="dirpick__tag">git</span> : null}
                      <span className="dirpick__time">
                        {e.modified ? fullTime(new Date(e.modified).toISOString()).slice(0, 16) : ''}
                      </span>
                      <Icon name="chevron-right" size={12} className="dirpick__icon" />
                    </button>
                  ))
                ) : dir && !editing ? (
                  <div className="dirpick__empty">
                    {dir.entries.length ? t('没有匹配的文件夹') : t('没有子目录')}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
