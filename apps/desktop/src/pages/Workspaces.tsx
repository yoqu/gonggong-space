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
import { useState } from 'react'
import logo from '../assets/logo.svg'
import { t } from '../i18n'
import { ipc, type WorkspaceChanges, type WorkspaceRow, type WorkspaceState } from '../ipc'
import { ContextBadge } from '../lib/ContextBadge'
import { revealLabel, tildify } from '../lib/labels'
import { fail, Section } from '../lib/ui'
import { useIpc } from '../lib/useIpc'
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

/** A sync backup is `<groupId>/<MMDD-HHMMSS>-<botId>[-n]`: named after the group and Bot when a workspace row knows them. */
function backupLabel(name: string, rows: WorkspaceRow[]) {
  const m = /^([^/]+)\/(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(.+)$/.exec(name)
  if (!m) return name
  const [, groupId, mo, d, h, mi, s, rest] = m
  const group = rows.find((r) => r.groupId === groupId)?.group
  const bot = rows.find((r) => rest === r.botId || rest?.startsWith(`${r.botId}-`))?.bot
  return group && bot ? `${group} · ${bot} · ${mo}-${d} ${h}:${mi}:${s}` : name
}

/** `还有 3 处未提交的改动、2 个未推送的提交，删除后会丢失`, naming only what there is; null when nothing would be lost. */
function lossWarning(c: WorkspaceChanges | null) {
  if (c?.unknown) return t('无法确认是否有未保存的改动')
  const parts = [
    c?.uncommitted ? t('{n} 处未提交的改动', { n: c.uncommitted }) : null,
    c?.unpushed ? t('{n} 个未推送的提交', { n: c.unpushed }) : null,
  ].filter(Boolean)
  return parts.length ? t('还有 {list}，删除后会丢失', { list: parts.join(t('、')) }) : null
}

export function WorkspacesPage(_: PageProps) {
  const os = useDaemon((s) => s.info?.machine.os)
  const { data, error, loading, reload: load } = useIpc(ipc.workspaces)
  // Kept after closing so the alert keeps its text while it animates out.
  const [doomed, setDoomed] = useState<WorkspaceRow | null>(null)
  // What the confirmation shows; the delete is refused when there is more to lose by then.
  const [seen, setSeen] = useState<WorkspaceChanges | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [checkingPath, setCheckingPath] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [resettingKey, setResettingKey] = useState<string | null>(null)

  const resetCd = async (w: WorkspaceRow) => {
    const key = `${w.groupId}:${w.botId}`
    if (resettingKey === key) return
    setResettingKey(key)
    try {
      await ipc.resetCd(w.groupId, w.botId)
      toast({ type: 'success', message: t('已请求 {bot} 改回托管工作区，结果见群消息', { bot: w.bot }) })
      // The binding flips once this machine answers the server's workspace.cd.
      setTimeout(() => void load(), RESET_RELOAD_MS)
    } catch (e) {
      fail(e)
    } finally {
      setResettingKey((cur) => (cur === key ? null : cur))
    }
  }

  // Counted afresh: work may have landed on any branch since the list loaded.
  const requestDelete = async (w: WorkspaceRow) => {
    if (checkingPath) return
    setCheckingPath(w.path)
    try {
      const changes = await ipc.workspaceChanges(w.path)
      setDoomed(w)
      setSeen(changes)
      setConfirming(true)
    } catch (e) {
      fail(e)
    } finally {
      setCheckingPath(null)
    }
  }

  const loss = lossWarning(seen)

  const closeConfirm = () => {
    if (!deleting) setConfirming(false)
  }

  const remove = async (w: WorkspaceRow, shown: WorkspaceChanges) => {
    if (deleting) return
    setDeleting(true)
    try {
      await ipc.deleteWorkspace(w.groupId, w.botId, w.path, shown)
      toast({ type: 'success', message: t('已删除 {path}', { path: tildify(w.path) }) })
      await load()
      setConfirming(false)
    } catch (e) {
      fail(e)
      // Work may have landed while it was open: show the fresh count before another try.
      await ipc.workspaceChanges(w.path).then(setSeen, () => {})
    } finally {
      setDeleting(false)
    }
  }

  if (!data) {
    if (error)
      return <Alert variant="error" description={error} retrying={loading} onRetry={() => void load()} />
    return <Skeleton count={4} />
  }

  const columns: TableColumn<Row>[] = [
    { key: 'group', title: t('群'), width: '1.2fr' },
    { key: 'bot', title: 'Bot', width: '1fr', secondary: true },
    { key: 'kindLabel', title: t('类型'), width: 84 },
    {
      key: 'path',
      title: t('路径'),
      width: '2fr',
      mono: true,
      secondary: true,
      render: (w) => tildify(w.path),
    },
    {
      key: 'state',
      title: t('状态'),
      width: 128,
      render: (w) => <Tag tone={STATE_TONE[w.state]}>{w.stateLabel}</Tag>,
    },
    {
      key: 'context',
      title: t('上下文'),
      width: 72,
      render: (w) => (w.context ? <ContextBadge bot={w.bot} context={w.context} /> : null),
    },
    {
      key: 'action',
      title: '',
      width: 168,
      align: 'right',
      render: (w) =>
        w.kind === 'cd' ? (
          <span className="dk-inline">
            <Button size="small" onClick={() => ipc.reveal(w.path).catch(fail)}>
              {t('打开')}
            </Button>
            <Button
              size="small"
              loading={resettingKey === `${w.groupId}:${w.botId}`}
              onClick={() => void resetCd(w)}
            >
              {t('改回托管')}
            </Button>
          </span>
        ) : w.deletable ? (
          <Button size="small" loading={checkingPath === w.path} onClick={() => void requestDelete(w)}>
            {t('删除…')}
          </Button>
        ) : (
          <Button size="small" onClick={() => ipc.reveal(w.path).catch(fail)}>
            {t('打开')}
          </Button>
        ),
    },
  ]

  return (
    <>
      {data.offline ? (
        <Alert
          variant="warning"
          title={t('无法连接服务器')}
          description={t('暂时连不上服务器，以下仅列出本机目录，群和 Bot 名称恢复连接后显示。')}
        />
      ) : null}
      <Table<Row>
        aria-label={t('工作区')}
        multiple={false}
        columns={columns}
        rows={data.rows.map((w) => ({ ...w, id: w.path }))}
        onOpen={(w) => ipc.reveal(w.path).catch(fail)}
        emptyText={<EmptyState compact icon="folder" title={t('本机还没有工作区')} />}
      />
      <Section
        title={t('本机备份 · 不上传')}
        aside={<HelpButton help={t('被覆盖的本地修改、中断的半成品保存在这里，不上传服务器。')} />}
      >
        <GroupBox>
          {data.backups.length === 0 ? <EmptyState compact icon="archive" title={t('暂无本机备份')} /> : null}
          {data.backups.map((b) => (
            <div key={b.path} className="dk-row">
              <Icon name="archive" size={16} color="var(--system-brown)" />
              <div className="dk-row__main">
                <span className="dk-ellipsis">
                  {backupLabel(b.name, data.rows)} · {b.size}
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
        onClose={closeConfirm}
        icon={<img src={logo} alt="" width={48} height={48} />}
        title={
          doomed
            ? t('要从本机删除「{group} × {bot}」的工作区吗？', { group: doomed.group, bot: doomed.bot })
            : ''
        }
        message={
          doomed
            ? t('将删除 {path}（{state}），此操作不可撤销。只影响本机目录，群里的消息与记录不受影响。', {
                path: tildify(doomed.path),
                state: doomed.stateLabel,
              })
            : null
        }
        actions={[
          { label: t('取消'), disabled: deleting, onClick: closeConfirm },
          {
            label: t('删除'),
            variant: 'destructive',
            disabled: deleting,
            loading: deleting,
            onClick: () => doomed && seen && void remove(doomed, seen),
          },
        ]}
        detail={loss ? <Alert variant="warning" title={loss} /> : null}
      />
    </>
  )
}
