import { Alert, AlertDialog, Button, EmptyState, GroupBox, Icon, Spinner, toast } from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { ipc, type WorkspaceRow, type WorkspaceState, type Workspaces } from '../ipc'
import { revealLabel, tildify } from '../lib/labels'
import { Section, StatusText } from '../lib/ui'
import { useDaemon } from '../store'
import type { PageProps } from '.'

const STATE_COLOR: Record<WorkspaceState, string> = {
  running: 'var(--system-blue)',
  idle: 'var(--system-gray)',
  removed: 'var(--system-orange)',
  unused: 'var(--system-orange)',
}

const RESET_RELOAD_MS = 2000

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })

export function WorkspacesPage(_: PageProps) {
  const os = useDaemon((s) => s.info?.machine.os)
  const [data, setData] = useState<Workspaces | null>(null)
  // Kept after closing so the alert keeps its text while it animates out.
  const [doomed, setDoomed] = useState<WorkspaceRow | null>(null)
  const [confirming, setConfirming] = useState(false)

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
    setConfirming(false)
    try {
      await ipc.deleteWorkspace(w.groupId, w.botId, w.path)
      toast({ type: 'success', message: `已删除 ${tildify(w.path)}` })
    } catch (e) {
      fail(e)
    }
    await load()
  }

  if (!data) return <Spinner size={16} />

  return (
    <>
      {data.offline ? (
        <Alert
          variant="warning"
          title="无法连接服务器"
          description="群与 Bot 名称、/cd 绑定暂不可用，以下仅按本机目录列出。"
        />
      ) : null}
      <div className="dk-table">
        <div className="dk-table__head dk-ws-grid">
          <span>群 × Bot</span>
          <span>类型</span>
          <span>路径</span>
          <span>状态</span>
          <span />
        </div>
        {data.rows.length === 0 ? <EmptyState bare title="本机还没有工作区" /> : null}
        {data.rows.map((w) => (
          <div key={w.path} className="dk-table__row dk-ws-grid" data-testid="ws-row">
            <div className="dk-row__main">
              <span className="dk-strong dk-ellipsis">{w.group}</span>
              <span className="dk-sub dk-ellipsis">{w.bot}</span>
            </div>
            <span>{w.kindLabel}</span>
            <span className="dk-ellipsis dk-mono dk-sub" title={w.path}>
              {tildify(w.path)}
            </span>
            <StatusText color={STATE_COLOR[w.state]}>{w.stateLabel}</StatusText>
            <div className="dk-table__action">
              {w.kind === 'cd' ? (
                <Button size="small" onClick={() => resetCd(w)}>
                  改回托管
                </Button>
              ) : w.deletable ? (
                <Button
                  size="small"
                  onClick={() => {
                    setDoomed(w)
                    setConfirming(true)
                  }}
                >
                  删除…
                </Button>
              ) : (
                <Button size="small" onClick={() => ipc.reveal(w.path).catch(fail)}>
                  打开
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Section title="本机备份 · 不上传">
        <GroupBox>
          {data.backups.length === 0 ? <div className="dk-row dk-row--empty">暂无本机备份</div> : null}
          {data.backups.map((b) => (
            <div key={b.path} className="dk-row">
              <Icon name="archive" size={16} color="var(--system-brown)" />
              <div className="dk-row__main">
                <span className="dk-ellipsis">
                  {b.name} · {b.size}
                </span>
                <span className="dk-mono dk-sub dk-ellipsis" title={b.path}>
                  {tildify(b.path)}
                </span>
              </div>
              <Button onClick={() => ipc.reveal(b.path).catch(fail)}>{revealLabel(os)}</Button>
            </div>
          ))}
        </GroupBox>
      </Section>
      <AlertDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={doomed ? `要从本机删除“${doomed.group} × ${doomed.bot}”的工作区吗？` : ''}
        message={
          doomed
            ? `将删除 ${tildify(doomed.path)}（${doomed.stateLabel}），此操作不可撤销。只影响本机目录，群里的消息与记录不受影响。`
            : null
        }
        actions={[
          { label: '取消', onClick: () => setConfirming(false) },
          { label: '删除', variant: 'destructive', onClick: () => doomed && remove(doomed) },
        ]}
      />
    </>
  )
}
