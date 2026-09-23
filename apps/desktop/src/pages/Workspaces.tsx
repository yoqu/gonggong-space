import { Alert, Button, Dialog, EmptyState, Spinner, toast } from '@web/ui'
import { Archive } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ipc, type WorkspaceRow, type WorkspaceState, type Workspaces } from '../ipc'
import { revealLabel, tildify } from '../lib/labels'
import { useDaemon } from '../store'
import type { PageProps } from '.'

const STATE_COLOR: Record<WorkspaceState, string> = {
  running: '#0A84FF',
  idle: 'var(--color-text-secondary)',
  removed: '#FF9F0A',
  unused: '#FF9F0A',
}

const RESET_RELOAD_MS = 2000

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })

export function WorkspacesPage(_: PageProps) {
  const os = useDaemon((s) => s.info?.machine.os)
  const [data, setData] = useState<Workspaces | null>(null)
  const [doomed, setDoomed] = useState<WorkspaceRow | null>(null)

  const load = useCallback(() => ipc.workspaces().then(setData, fail), [])
  useEffect(() => {
    load()
  }, [load])

  const resetCd = async (w: WorkspaceRow) => {
    try {
      await ipc.resetCd(w.groupId, w.botId)
      toast({ type: 'success', message: `已请求 ${w.bot} 改回托管工作区，结果见群消息` })
      // The binding flips once this machine answers the server's workspace.cd.
      setTimeout(load, RESET_RELOAD_MS)
    } catch (e) {
      fail(e)
    }
  }

  const remove = async (w: WorkspaceRow) => {
    setDoomed(null)
    try {
      await ipc.deleteWorkspace(w.groupId, w.botId, w.path)
      toast({ type: 'success', message: `已删除 ${tildify(w.path)}` })
    } catch (e) {
      fail(e)
    }
    await load()
  }

  if (!data) return <Spinner size={18} />

  return (
    <>
      {data.offline ? (
        <Alert
          variant="warning"
          title="无法连接服务器"
          description="群与 bot 名称、/cd 绑定暂不可用，以下仅按本机目录列出。"
        />
      ) : null}
      <div className="dk-table">
        <div className="dk-table__head dk-ws-grid">
          <span>群 × bot</span>
          <span>类型</span>
          <span>路径</span>
          <span>状态</span>
          <span />
        </div>
        {data.rows.length === 0 ? <EmptyState bare title="本机还没有工作区" /> : null}
        {data.rows.map((w) => (
          <div key={w.path} className="dk-table__row dk-ws-grid" data-testid="ws-row">
            <div className="dk-row__main">
              <span className="dk-strong">{w.group}</span>
              <span className="dk-sub">{w.bot}</span>
            </div>
            <span>{w.kindLabel}</span>
            <span className="dk-ellipsis dk-mono-hint" title={w.path}>
              {tildify(w.path)}
            </span>
            <span style={{ color: STATE_COLOR[w.state] }}>{w.stateLabel}</span>
            <div className="dk-table__action">
              {w.kind === 'cd' ? (
                <Button variant="ghost" size="xs" onClick={() => resetCd(w)}>
                  改回托管
                </Button>
              ) : w.deletable ? (
                <Button variant="ghost" size="xs" onClick={() => setDoomed(w)}>
                  删除
                </Button>
              ) : (
                <Button variant="ghost" size="xs" onClick={() => ipc.reveal(w.path).catch(fail)}>
                  打开
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="dk-eyebrow">本机备份 · 不上传</div>
      {data.backups.length === 0 ? <div className="dk-card dk-card--muted">暂无本机备份</div> : null}
      {data.backups.map((b) => (
        <div key={b.path} className="dk-backup">
          <Archive size={13} className="dk-backup__icon" />
          <span className="dk-flex dk-ellipsis">
            {b.name} · {b.size}
          </span>
          <span className="dk-mono-hint dk-ellipsis dk-backup__path" title={b.path}>
            {tildify(b.path)}
          </span>
          <Button variant="ghost" size="xs" onClick={() => ipc.reveal(b.path).catch(fail)}>
            {revealLabel(os)}
          </Button>
        </div>
      ))}
      <Dialog
        open={!!doomed}
        onClose={() => setDoomed(null)}
        title="删除工作区？"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDoomed(null)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={() => doomed && remove(doomed)}>
              删除
            </Button>
          </>
        }
      >
        {doomed
          ? `将从本机删除 ${tildify(doomed.path)}（${doomed.group} × ${doomed.bot}，${doomed.stateLabel}）。只影响本机目录，群里的消息与记录不受影响。`
          : null}
      </Dialog>
    </>
  )
}
