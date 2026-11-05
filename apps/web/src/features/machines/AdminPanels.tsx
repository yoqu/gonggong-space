import {
  compareVersions,
  type DiagCheck,
  type MachineDto,
  type MachineWorkspace,
  type UpgradeState,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  Icon,
  IconButton,
  Presence,
  Select,
  Skeleton,
  Tag,
  type TagTone,
  toast,
} from '../../ui'
import { MirrorPanel } from './ToolsPanel'

export const upgradable = (m: MachineDto, latest: string | undefined): latest is string =>
  !!latest && !!m.daemonVersion && compareVersions(m.daemonVersion, latest) < 0

/** A command to run on the machine, with a copy button. */
export function CommandLine({ command }: { command: string }) {
  return (
    <div className="bind__cmd">
      <span className="bind__cmd-text">{command}</span>
      <IconButton title={t('复制命令')} onClick={() => void copyWithToast(command, t('已复制命令'))}>
        <Icon name="copy" />
      </IconButton>
    </div>
  )
}

/**
 * How to bring the daemon up to `latest`: a Linux CLI daemon can be told to upgrade now; otherwise a connected CLI
 * daemon fetches the new build itself on reconnect, the desktop app updates as an app, a container comes from a new image.
 */
export function UpgradeGuide({ machine, latest }: { machine: MachineDto; latest: string }) {
  if (machine.features.includes('container'))
    return (
      <section className="machine-upgrade" aria-label={t('如何升级')}>
        <span className="mx-strong">{t('可升级到 {version}', { version: latest })}</span>
        <span className="mx-sub">
          {t(
            '该机器运行在 Docker 容器里，不会自行升级。在服务器的 docker/daemon 目录把 .env 里的 GG_VERSION 改为 {version}，再重建容器：',
            {
              version: latest,
            },
          )}
        </span>
        <CommandLine command="docker compose build && docker compose up -d" />
      </section>
    )
  if (machine.online && machine.features.includes('upgrade'))
    return <UpgradeNow machine={machine} latest={latest} />
  return (
    <section className="machine-upgrade" aria-label={t('如何升级')}>
      <span className="mx-strong">{t('可升级到 {version}', { version: latest })}</span>
      <span className="mx-sub">
        {machine.features.includes('noAutoUpgrade')
          ? t('该机器关闭了自动升级。升级方式：')
          : t('daemon 在线时会自动下载新版本，没有任务运行时重启完成升级。一直没有升级时：')}
      </span>
      <span>{t('桌面端：在该机器上打开共工空间客户端，点「检查更新」')}</span>
      <span>{t('命令行：在该机器上重启 daemon，重连后自动升级')}</span>
      <CommandLine command="gg run" />
    </section>
  )
}

/** A Linux CLI daemon that upgrades itself: downloads now, restarts once no run is active (its version then changes). */
function UpgradeNow({ machine, latest }: { machine: MachineDto; latest: string }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const start = async () => {
    setBusy(true)
    try {
      const { state, version } = await api.post<{ state: UpgradeState; version: string }>(
        `/machines/${machine.id}/upgrade`,
      )
      if (state === 'refused')
        toast({ type: 'error', message: t('{version} 校验失败，已拒绝安装', { version }) })
      else if (state === 'current') toast({ type: 'success', message: t('已是最新版本') })
      else
        setStatus(
          state === 'ready'
            ? t('{version} 已下载，没有任务运行时自动重启完成升级', { version })
            : t('正在下载 {version}，没有任务运行时自动重启完成升级', { version }),
        )
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="machine-upgrade" aria-label={t('如何升级')}>
      <span className="mx-strong">{t('可升级到 {version}', { version: latest })}</span>
      {status ? (
        <span className="mx-sub">{status}</span>
      ) : (
        <>
          <span className="mx-sub">
            {t('下载新版本后，在没有任务运行时自动重启完成升级，不会打断正在运行的任务。')}
          </span>
          <span>
            <Button size="small" variant="primary" loading={busy} onClick={() => void start()}>
              {t('立即升级')}
            </Button>
          </span>
        </>
      )}
    </section>
  )
}

const CHECK_LABEL: Record<DiagCheck['kind'], string> = {
  server: t('服务器连接'),
  agent: 'Agent',
  git: t('git 凭据'),
  disk: t('磁盘'),
  eol: t('换行符'),
  screen_recording: t('屏幕录制'),
  accessibility: t('辅助功能'),
}
const CHECK_TONE: Record<DiagCheck['status'], TagTone> = {
  ok: 'green',
  warn: 'orange',
  error: 'red',
  skipped: 'gray',
}
const CHECK_STATUS: Record<DiagCheck['status'], string> = {
  ok: t('正常'),
  warn: t('注意'),
  error: t('异常'),
  skipped: t('跳过'),
}

/** `gg doctor` run on the machine; a git problem links to Git 访问. */
function SelfChecks({ machine, onOpenGit }: { machine: MachineDto; onOpenGit?: () => void }) {
  const { data, error, reload } = useGet<DiagCheck[]>(`/machines/${machine.id}/diag`)
  return (
    <section className="mx-section" aria-label={t('自检')}>
      <div className="mx-section__head">
        <span className="mx-row__main mx-strong">{t('自检')}</span>
        <Button size="small" icon="arrow-clockwise" onClick={reload}>
          {t('重新检查')}
        </Button>
      </div>
      {error ? (
        <Alert variant="error" title={error} />
      ) : !data ? (
        <Skeleton count={4} />
      ) : (
        <GroupBox>
          {data
            .filter((c) => c.status !== 'skipped')
            .map((c) => (
              <GroupRow
                key={c.kind}
                label={
                  <span className="mx-inline">
                    {CHECK_LABEL[c.kind]}
                    <Tag tone={CHECK_TONE[c.status]}>{CHECK_STATUS[c.status]}</Tag>
                  </span>
                }
                description={c.detail}
                value={
                  c.kind === 'git' && c.status !== 'ok' && onOpenGit ? (
                    <Button size="small" onClick={onOpenGit}>
                      {t('去配置')}
                    </Button>
                  ) : undefined
                }
              />
            ))}
        </GroupBox>
      )}
    </section>
  )
}

/** 诊断: the daemon version, its self-checks, the mirror its tools download from and its log. */
export function DiagnosticsPanel({
  machine,
  latest,
  onOpenGit,
}: {
  machine: MachineDto
  latest?: string
  onOpenGit?: () => void
}) {
  const version = machine.daemonVersion
  return (
    <div className="mx">
      <GroupBox>
        <GroupRow
          label={t('daemon 版本')}
          wideValue
          value={
            <span className="mx-inline">
              {version ? `v${version}` : '--'}
              {upgradable(machine, latest) ? (
                <Tag tone="orange">{t('可升级到 {version}', { version: latest })}</Tag>
              ) : null}
            </span>
          }
        />
      </GroupBox>
      {upgradable(machine, latest) ? <UpgradeGuide machine={machine} latest={latest} /> : null}
      {machine.features.includes('diag') ? <SelfChecks machine={machine} onOpenGit={onOpenGit} /> : null}
      {machine.features.includes('tools') ? <MirrorPanel machine={machine} /> : null}
      {machine.features.includes('machineAdmin') ? <LogsPanel machine={machine} /> : null}
    </div>
  )
}

type Level = 'error' | 'warn' | 'info' | 'debug'
const LEVELS: { value: Level; label: string }[] = [
  { value: 'error', label: t('错误') },
  { value: 'warn', label: t('警告及以上') },
  { value: 'info', label: t('信息及以上') },
  { value: 'debug', label: t('全部（含调试）') },
]
const LOG_LINES = 300

/** The machine's daemon log, newest last; credentials are masked on the machine before they are sent. */
function LogsPanel({ machine }: { machine: MachineDto }) {
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
const STALE_MS = 30 * 24 * 3600_000
/** Worth freeing: deletable now, or a hosted workspace no turn has touched in 30 days (only flagged, never deleted). */
const freeable = (w: MachineWorkspace, now: number) =>
  deletable(w) ||
  (w.kind !== 'cd' && w.state !== 'running' && w.lastUsedAt !== null && now - w.lastUsedAt > STALE_MS)
const hasChanges = (w: MachineWorkspace) => !!w.changes && w.changes.uncommitted + w.changes.unpushed > 0
const keyOf = (w: MachineWorkspace) => `${w.groupId}/${w.botId}/${w.path}`
const sum = (ws: MachineWorkspace[]) => ws.reduce((n, w) => n + (w.size ?? 0), 0)

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

type Listing = { entries: MachineWorkspace[]; disk: { free: number; total: number } | null }

/** 工作区: every workspace on the machine by group and bot; removed or unused hosted ones can be deleted, idle ones slimmed. */
export function WorkspacesPanel({ machine }: { machine: MachineDto }) {
  const { data, error, reload } = useGet<Listing>(`/machines/${machine.id}/workspaces`)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [slimming, setSlimming] = useState<string | null>(null)
  const canGc = machine.features.includes('storageAdmin')
  const entries = data?.entries ?? []
  const selected = entries.filter((w) => deletable(w) && picked.has(keyOf(w)))
  const target = (w: MachineWorkspace) => ({ groupId: w.groupId, botId: w.botId, path: w.path })

  const removeSelected = async () => {
    setDeleting(true)
    for (const w of selected) {
      try {
        await api.post(`/machines/${machine.id}/workspaces/delete`, target(w))
      } catch (e) {
        toastError(e)
      }
    }
    setDeleting(false)
    setConfirm(false)
    setPicked(new Set())
    reload()
  }
  const slim = async (w: MachineWorkspace) => {
    setSlimming(keyOf(w))
    try {
      const r = await api.post<{ before: number; after: number }>(
        `/machines/${machine.id}/workspaces/gc`,
        target(w),
      )
      toast({
        type: 'success',
        message: t('已释放 {size}', { size: sizeText(Math.max(0, r.before - r.after)) }),
      })
      reload()
    } catch (e) {
      toastError(e)
    } finally {
      setSlimming(null)
    }
  }
  const toggle = (w: MachineWorkspace, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p)
      if (on) next.add(keyOf(w))
      else next.delete(keyOf(w))
      return next
    })

  const now = Date.now()
  const used = sum(entries.filter((w) => w.kind !== 'cd'))
  const free = sum(entries.filter((w) => freeable(w, now)))
  const groups = new Map<string, MachineWorkspace[]>()
  for (const w of entries) groups.set(w.groupId, [...(groups.get(w.groupId) ?? []), w])
  const risky = selected.filter(hasChanges)
  return (
    <section className="machine-admin" aria-label={t('工作区#tab')}>
      <div className="machine-admin__bar">
        <Button size="small" icon="arrow-clockwise" onClick={reload}>
          {t('刷新')}
        </Button>
        <Button
          size="small"
          variant="destructive"
          disabled={!selected.length}
          onClick={() => setConfirm(true)}
        >
          {t('删除所选')}
        </Button>
        {data ? (
          <span className="machine-admin__hint">{t('合计占用 {size}', { size: sizeText(used) })}</span>
        ) : null}
        {data?.disk ? (
          <span className="machine-admin__hint">
            {t('磁盘剩余 {free} / 共 {total}', {
              free: sizeText(data.disk.free),
              total: sizeText(data.disk.total),
            })}
          </span>
        ) : null}
        {free ? (
          <span className="machine-admin__hint">{t('可释放 {size}', { size: sizeText(free) })}</span>
        ) : null}
      </div>
      {error ? (
        <Alert variant="error" title={error} />
      ) : !data ? (
        <Skeleton count={4} />
      ) : entries.length ? (
        [...groups.values()].map((ws) => {
          const g = ws[0] as MachineWorkspace
          return (
            <div key={g.groupId} className="machine-admin__group">
              <span className="machine-admin__group-name">
                {g.dm ? t('私聊') : (g.groupName ?? g.groupId)}
              </span>
              <GroupBox>
                {ws.map((w) => {
                  const name = w.botName ?? w.botId
                  return (
                    <GroupRow
                      key={keyOf(w)}
                      label={
                        deletable(w) ? (
                          <Checkbox
                            label={name}
                            checked={picked.has(keyOf(w))}
                            onChange={(on) => toggle(w, on)}
                          />
                        ) : (
                          name
                        )
                      }
                      description={w.path}
                    >
                      <span className="machine-admin__row">
                        <Tag tone="gray">{KIND[w.kind]}</Tag>
                        <Tag tone={w.state === 'running' ? 'blue' : w.state === 'idle' ? 'green' : 'orange'}>
                          {STATE[w.state]}
                        </Tag>
                        {hasChanges(w) && w.changes ? (
                          <Tag tone="orange">
                            {t('{a} 个未提交 · {b} 个未推送', {
                              a: w.changes.uncommitted,
                              b: w.changes.unpushed,
                            })}
                          </Tag>
                        ) : null}
                        {w.size !== null ? (
                          <span className="machine-admin__size">{sizeText(w.size)}</span>
                        ) : null}
                        {w.lastUsedAt !== null ? (
                          <span className="machine-admin__size">
                            {t('{when}使用', { when: ago(new Date(w.lastUsedAt).toISOString(), now) })}
                          </span>
                        ) : null}
                        {canGc && w.kind === 'managed' && w.state !== 'running' ? (
                          <Button
                            size="small"
                            variant="plain"
                            disabled={slimming !== null}
                            onClick={() => void slim(w)}
                          >
                            {slimming === keyOf(w) ? t('正在瘦身…') : t('瘦身')}
                          </Button>
                        ) : null}
                      </span>
                    </GroupRow>
                  )
                })}
              </GroupBox>
            </div>
          )
        })
      ) : (
        <EmptyState compact title={t('这台机器上还没有工作区')} />
      )}
      <Presence>
        {confirm ? (
          <Dialog
            open
            role="alertdialog"
            title={t('删除所选的 {n} 个工作区？', { n: selected.length })}
            message={t('会删除机器上的这些目录，不可恢复。')}
            onClose={() => setConfirm(false)}
            actions={[
              { label: t('取消'), onClick: () => setConfirm(false), autoFocus: true },
              {
                label: deleting ? t('正在删除…') : t('删除'),
                variant: 'destructive',
                disabled: deleting,
                onClick: () => void removeSelected(),
              },
            ]}
          >
            <ul className="ui-consequences">
              {selected.map((w) => (
                <li key={keyOf(w)}>{w.path}</li>
              ))}
            </ul>
            {risky.length ? (
              <Alert variant="warning" title={t('这些工作区还有没推送的改动，删除后会丢失')}>
                <ul className="ui-consequences">
                  {risky.map((w) => (
                    <li key={keyOf(w)}>
                      {`${w.path}（${t('{a} 个未提交 · {b} 个未推送', { a: w.changes?.uncommitted ?? 0, b: w.changes?.unpushed ?? 0 })}）`}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </Dialog>
        ) : null}
      </Presence>
    </section>
  )
}
