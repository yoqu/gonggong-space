import type { DirListingDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Button, Dialog, Icon, Input, Spinner } from '../../ui'
import './workspaces.css'

const parentOf = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return null
  return cut === 0 ? '/' : trimmed.slice(0, cut) || null
}
const join = (dir: string, name: string) =>
  `${dir.replace(/[\\/]+$/, '')}${dir.includes('\\') ? '\\' : '/'}${name}`

/** Browse the machine's directories (via its daemon) and pick one as a workspace; `extra` adds other choices. */
export function DirPicker({
  machineId,
  title,
  start = null,
  extra,
  onPick,
  onClose,
}: {
  machineId: string
  title: string
  start?: string | null
  extra?: ReactNode
  onPick: (path: string) => void
  onClose: () => void
}) {
  const [path, setPath] = useState<string | null>(start)
  const [typed, setTyped] = useState(start ?? '')
  const [dir, setDir] = useState<DirListingDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setDir(null)
    setError(null)
    const q = path ? `?path=${encodeURIComponent(path)}` : ''
    api
      .get<DirListingDto>(`/machines/${machineId}/dirs${q}`)
      .then((d) => {
        if (!live) return
        setDir(d)
        setTyped(d.path)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [machineId, path])

  const up = dir && parentOf(dir.path)
  return (
    <Dialog
      open
      title={title}
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={!dir || !!dir.unusable}
            title={dir?.unusable ?? undefined}
            onClick={() => dir && onPick(dir.path)}
          >
            选择此目录
          </Button>
        </>
      }
    >
      <div className="dirpick">
        {extra}
        <form
          className="dirpick__bar"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed.trim()) setPath(typed.trim())
          }}
        >
          <Button
            icon="arrow-turn-left-up"
            aria-label="上一级"
            title="上一级"
            disabled={!up}
            onClick={() => up && setPath(up)}
          />
          <Input
            size="sm"
            mono
            value={typed}
            aria-label="目录路径"
            onChange={(e) => setTyped(e.target.value)}
          />
        </form>
        {dir?.git ? (
          <div className="dirpick__git" data-testid="dirpick-git">
            <Icon name="git-branch" size={13} />
            <span>git 仓库 · {dir.git.branch ?? '游离 HEAD'}</span>
            <span className="dirpick__remote">{dir.git.remotes[0] ?? '无 remote'}</span>
          </div>
        ) : null}
        {/* Browsing starts at home, which is never selectable itself: guide rather than warn. */}
        {dir?.unusable ? <p className="dirpick__hint">进入具体项目目录后选择</p> : null}
        {error ? <Alert variant="error" title={error} /> : null}
        <div className="dirpick__list">
          {!dir && !error ? (
            <div className="dirpick__loading">
              <Spinner />
            </div>
          ) : dir?.entries.length ? (
            dir.entries.map((e) => (
              <button
                key={e.name}
                type="button"
                className="dirpick__item"
                onClick={() => setPath(join(dir.path, e.name))}
              >
                <Icon name="folder" size={14} className="dirpick__icon" />
                <span className="dirpick__name">{e.name}</span>
                {e.git ? <span className="dirpick__tag">git</span> : null}
                <Icon name="chevron-right" size={12} className="dirpick__icon" />
              </button>
            ))
          ) : dir ? (
            <div className="dirpick__empty">没有子目录</div>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
