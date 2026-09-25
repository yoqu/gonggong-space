import {
  Alert,
  AlertDialog,
  Button,
  EmptyState,
  GroupBox,
  HelpButton,
  Icon,
  Skeleton,
  Table,
  type TableColumn,
  Tag,
  type TagTone,
  toast,
} from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import logo from '../assets/logo.svg'
import { ipc, type WorkspaceRow, type WorkspaceState, type Workspaces } from '../ipc'
import { revealLabel, tildify } from '../lib/labels'
import { Section } from '../lib/ui'
import { useDaemon } from '../store'
import type { PageProps } from '.'

const STATE_TONE: Record<WorkspaceState, TagTone> = {
  running: 'blue',
  idle: 'gray',
  removed: 'orange',
  unused: 'orange',
}

type Row = WorkspaceRow & { id: string }

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

  if (!data) return <Skeleton count={4} />

  const columns: TableColumn<Row>[] = [
    { key: 'group', title: '群', width: '1.2fr' },
    { key: 'bot', title: 'Bot', width: '1fr', secondary: true },
    { key: 'kindLabel', title: '类型', width: 84 },
    { key: 'path', title: '路径', width: '2fr', mono: true, secondary: true, render: (w) => tildify(w.path) },
    {
      key: 'state',
      title: '状态',
      width: 128,
      render: (w) => <Tag tone={STATE_TONE[w.state]}>{w.stateLabel}</Tag>,
    },
    {
      key: 'action',
      title: '',
      width: 96,
      align: 'right',
      render: (w) =>
        w.kind === 'cd' ? (
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
        ),
    },
  ]

  return (
    <>
      {data.offline ? (
        <Alert
          variant="warning"
          title="无法连接服务器"
          description="群与 Bot 名称、/cd 绑定暂不可用，以下仅按本机目录列出。"
        />
      ) : null}
      <Table<Row>
        aria-label="工作区"
        multiple={false}
        columns={columns}
        rows={data.rows.map((w) => ({ ...w, id: w.path }))}
        onOpen={(w) => ipc.reveal(w.path).catch(fail)}
        emptyText={<EmptyState compact icon="folder" title="本机还没有工作区" />}
      />
      <Section
        title="本机备份 · 不上传"
        aside={<HelpButton help="被覆盖的本地修改、中断的半成品保存在这里，不上传服务器。" />}
      >
        <GroupBox>
          {data.backups.length === 0 ? <EmptyState compact icon="archive" title="暂无本机备份" /> : null}
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
        icon={<img src={logo} alt="" width={48} height={48} />}
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
