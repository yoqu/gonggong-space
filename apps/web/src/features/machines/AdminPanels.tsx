import type { MachineDto, MachineWorkspace } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  Presence,
  Select,
  Skeleton,
  Tag,
} from '../../ui'

type Level = 'error' | 'warn' | 'info' | 'debug'
const LEVELS: { value: Level; label: string }[] = [
  { value: 'error', label: t('错误') },
  { value: 'warn', label: t('警告及以上') },
  { value: 'info', label: t('信息及以上') },
  { value: 'debug', label: t('全部（含调试）') },
]
const LOG_LINES = 300

/** The machine's daemon log, newest last; credentials are masked on the machine before they are sent. */
export function LogsPanel({ machine }: { machine: MachineDto }) {
  const [level, setLevel] = useState<Level>('info')
  const { data, error, reload } = useGet<{ lines: { level: Level; text: string }[] }>(
    `/machines/${machine.id}/logs?level=${level}&limit=${LOG_LINES}`,
  )
  return (
    <section className="machine-admin" aria-label={t('日志')}>
      <div className="machine-admin__bar">
        <Select label={t('级别')} options={LEVELS} value={level} onChange={setLevel} />
        <Button size="small" icon="arrow-clockwise" onClick={reload}>
          {t('刷新')}
        </Button>
        <span className="machine-admin__hint">
          {t('最近 {n} 行，密钥与令牌已在机器上打码', { n: LOG_LINES })}
        </span>
      </div>
      {error ? (
        <Alert variant="error" title={error} />
      ) : !data ? (
        <Skeleton count={6} />
      ) : data.lines.length ? (
        <pre className="machine-logs">
          {data.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines have no identity of their own
            <span key={i} className="machine-logs__line" data-level={l.level}>
              {l.text}
              {'\n'}
            </span>
          ))}
        </pre>
      ) : (
        <EmptyState compact title={t('没有日志')} />
      )}
    </section>
  )
}

const KIND: Record<MachineWorkspace['kind'], string> = {
  managed: t('托管'),
  empty: t('托管 · 无仓库'),
  cd: t('本机目录'),
}
const STATE: Record<MachineWorkspace['state'], string> = {
  running: t('运行中'),
  idle: t('空闲'),
  removed: t('已移出'),
  unused: t('未使用'),
}
const deletable = (w: MachineWorkspace) => w.kind !== 'cd' && (w.state === 'removed' || w.state === 'unused')

export const sizeText = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

/** Every workspace on the machine with its size; removed or unused managed ones can be deleted to free space. */
export function WorkspacesPanel({ machine }: { machine: MachineDto }) {
  const { data, error, reload } = useGet<{ entries: MachineWorkspace[] }>(
    `/machines/${machine.id}/workspaces`,
  )
  const [confirm, setConfirm] = useState<MachineWorkspace | null>(null)
  const [deleting, setDeleting] = useState(false)
  const remove = async (w: MachineWorkspace) => {
    setDeleting(true)
    try {
      await api.post(`/machines/${machine.id}/workspaces/delete`, {
        groupId: w.groupId,
        botId: w.botId,
        path: w.path,
      })
      setConfirm(null)
      reload()
    } catch (e) {
      toastError(e)
    } finally {
      setDeleting(false)
    }
  }
  const freeable = data?.entries.filter(deletable).reduce((n, w) => n + (w.size ?? 0), 0) ?? 0
  return (
    <section className="machine-admin" aria-label={t('工作区')}>
      <div className="machine-admin__bar">
        <Button size="small" icon="arrow-clockwise" onClick={reload}>
          {t('刷新')}
        </Button>
        {freeable ? (
          <span className="machine-admin__hint">{t('可清理 {size}', { size: sizeText(freeable) })}</span>
        ) : null}
      </div>
      {error ? (
        <Alert variant="error" title={error} />
      ) : !data ? (
        <Skeleton count={4} />
      ) : data.entries.length ? (
        <GroupBox>
          {data.entries.map((w) => (
            <GroupRow
              key={`${w.groupId}/${w.botId}/${w.path}`}
              label={`${w.dm ? t('私聊') : (w.groupName ?? w.groupId)} · ${w.botName ?? w.botId}`}
              description={w.path}
            >
              <span className="machine-admin__row">
                <Tag tone="gray">{KIND[w.kind]}</Tag>
                <Tag tone={w.state === 'running' ? 'blue' : w.state === 'idle' ? 'green' : 'orange'}>
                  {STATE[w.state]}
                </Tag>
                {w.size !== null ? <span className="machine-admin__size">{sizeText(w.size)}</span> : null}
                {deletable(w) ? (
                  <Button size="small" variant="plain" onClick={() => setConfirm(w)}>
                    {t('删除')}
                  </Button>
                ) : null}
              </span>
            </GroupRow>
          ))}
        </GroupBox>
      ) : (
        <EmptyState compact title={t('这台机器上还没有工作区')} />
      )}
      <Presence>
        {confirm ? (
          <Dialog
            open
            role="alertdialog"
            title={t('删除这个工作区？')}
            message={t('会删除机器上的 {path}，不可恢复。', { path: confirm.path })}
            onClose={() => setConfirm(null)}
            actions={[
              { label: t('取消'), onClick: () => setConfirm(null), autoFocus: true },
              {
                label: deleting ? t('正在删除…') : t('删除'),
                variant: 'destructive',
                disabled: deleting,
                onClick: () => void remove(confirm),
              },
            ]}
          />
        ) : null}
      </Presence>
    </section>
  )
}
