import type { SyncReplicaDto, SyncStatusDto, SyncVersionDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { ago } from '../../lib/time'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  GroupBox,
  Presence,
  Spinner,
  Tabs,
  Tag,
  toast,
} from '../../ui'
import { ConflictDialog } from './ConflictDialog'
import { reasonText, STATE, shownState, TAG } from './model'
import { syncApi, useSyncLoad, VERSIONS_PAGE } from './store'
import './sync.css'

const FILES_SHOWN = 3

/** Why a replica sits out, when the daemon gave no words for it. */
const excludedText = (r: SyncReplicaDto) =>
  r.workspace === 'cd' ? t('本机目录') : r.issue === 'dirty' ? t('有未提交的改动') : t('未加入')

type Confirm = 'join' | 'discard' | null

function Replica({
  r,
  groupId,
  canAct,
  focus,
}: {
  r: SyncReplicaDto
  groupId: string
  canAct: boolean
  focus: boolean
}) {
  const shown = shownState(r)
  const state = STATE[shown]
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [conflict, setConflict] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) row.current?.scrollIntoView?.({ block: 'center' })
  }, [focus])
  const join = (force: boolean) => syncApi.join(groupId, r.botId, force)
  const joinable = canAct && r.state === 'excluded' && r.workspace === 'managed'
  // Uncommitted changes would block a plain join again: they must be discarded (or cleaned up on the machine).
  const dirty = r.issue === 'dirty'
  const drift = canAct && r.issue === 'drift'
  const reason = reasonText(r) ?? (r.state === 'excluded' ? excludedText(r) : null)
  return (
    <div
      ref={row}
      className={focus ? 'sync-row sync-row--focus' : 'sync-row'}
      data-testid={`replica-${r.botId}`}
    >
      <span className="sync-row__main">
        <span className="sync-row__title">
          <span>{r.botName}</span>
          {r.machineName ? <span className="sync-muted">{r.machineName}</span> : null}
        </span>
        {reason ? <span className="sync-muted">{reason}</span> : null}
        {shown === 'error' ? <span className="sync-muted">{t('下一轮会自动重试')}</span> : null}
        {joinable && dirty ? <span className="sync-muted">{t('或先在本机提交、清理后再加入')}</span> : null}
        {r.files.length ? (
          <span className="sync-muted sync-mono">
            {r.files.slice(0, FILES_SHOWN).join(t('、'))}
            {r.files.length > FILES_SHOWN ? ` ${t('等 {n} 个文件', { n: r.files.length })}` : ''}
          </span>
        ) : null}
      </span>
      <span className="sync-row__meta">
        <span className="sync-mono">{r.version === null ? '—' : `v${r.version}`}</span>
        <Tag tone={state.tone}>{state.label}</Tag>
        {r.updatedAt ? <span className="sync-muted">{ago(r.updatedAt)}</span> : null}
      </span>
      <span className="sync-row__actions">
        {joinable && !dirty ? (
          <Button
            size="small"
            onClick={() =>
              void join(false).then(() => toast({ type: 'success', message: t('已开始加入') }), toastError)
            }
          >
            {t('加入')}
          </Button>
        ) : null}
        {joinable ? (
          <Button size="small" onClick={() => setConfirm('join')}>
            {t('丢弃本地改动并加入')}
          </Button>
        ) : null}
        {drift ? (
          <>
            <Button
              size="small"
              onClick={() =>
                void syncApi
                  .drift(groupId, r.botId, 'submit')
                  .then(() => toast({ type: 'success', message: t('已开始提交本地改动') }), toastError)
              }
            >
              {t('提交本地改动')}
            </Button>
            <Button size="small" onClick={() => setConfirm('discard')}>
              {t('丢弃本地改动')}
            </Button>
          </>
        ) : null}
        {canAct && r.issue === 'held' ? (
          <Button size="small" onClick={() => setConflict(true)}>
            {t('处理冲突')}
          </Button>
        ) : null}
      </span>
      <Presence>
        {conflict ? (
          <ConflictDialog
            groupId={groupId}
            botId={r.botId}
            botName={r.botName}
            onClose={() => setConflict(false)}
          />
        ) : null}
      </Presence>
      <Presence>
        {confirm === 'discard' ? (
          <ConfirmActionDialog
            title={t('丢弃本地改动')}
            message={t('{bot} 的工作区将回到最新版本。', { bot: r.botName })}
            consequences={[
              t('本地改动的文件会先备份到本机，再被覆盖或删除'),
              t('备份可在本机桌面端的「工作区」页找到'),
            ]}
            label={t('丢弃')}
            done={t('已开始丢弃本地改动')}
            run={() => syncApi.drift(groupId, r.botId, 'discard')}
            onClose={() => setConfirm(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {confirm === 'join' ? (
          <ConfirmActionDialog
            title={t('丢弃本地改动并加入')}
            message={t('{bot} 的工作区将与最新版本保持一致。', { bot: r.botName })}
            consequences={[
              t('未提交的改动和最新版本没有的文件会先备份到本机，再被覆盖或删除'),
              t('备份可在本机桌面端的「工作区」页找到'),
            ]}
            label={t('丢弃并加入')}
            done={t('已开始加入强制同步')}
            run={() => join(true)}
            onClose={() => setConfirm(null)}
          />
        ) : null}
      </Presence>
    </div>
  )
}

function Replicas({
  status,
  isAdmin,
  focusBotId,
}: {
  status: SyncStatusDto
  isAdmin: boolean
  focusBotId: string | null
}) {
  const me = useSession((s) => s.user)
  return status.replicas.length ? (
    <GroupBox>
      {status.replicas.map((r) => (
        <Replica
          key={r.botId}
          r={r}
          groupId={status.groupId}
          canAct={isAdmin || r.ownerId === me?.id}
          focus={r.botId === focusBotId}
        />
      ))}
    </GroupBox>
  ) : (
    <EmptyState title={t('还没有 Bot')} />
  )
}

function Version({ v }: { v: SyncVersionDto }) {
  return (
    <div className="sync-row" data-testid={`version-${v.version}`}>
      <span className="sync-row__main">
        <span className="sync-row__title">
          <span className="sync-mono">v{v.version}</span>
          {v.tags.map((tag) => (
            <Tag key={tag}>{TAG[tag]}</Tag>
          ))}
        </span>
        <span className="sync-muted">
          {v.author.kind === 'bot' ? `${v.author.name} · Bot` : v.author.name} ·{' '}
          {t('{n} 个文件', { n: v.files })}
        </span>
      </span>
      <span className="sync-muted">{ago(v.createdAt)}</span>
    </div>
  )
}

function Versions({ groupId, head }: { groupId: string; head: number }) {
  const [list, setList] = useState<SyncVersionDto[] | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const page = (before?: number) => {
    setBusy(true)
    setError(null)
    syncApi
      .versions(groupId, before)
      .then((r) => {
        setList((l) => (before && l ? [...l, ...r] : r))
        setMore(r.length === VERSIONS_PAGE)
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new head version reloads the newest page
  useEffect(() => page(), [groupId, head])

  if (error && !list)
    return (
      <EmptyState
        title={error}
        action={
          <Button size="small" onClick={() => page()}>
            {t('重试')}
          </Button>
        }
      />
    )
  if (!list) return null
  if (!list.length) return <EmptyState title={t('还没有版本')} />
  return (
    <>
      <GroupBox>
        {list.map((v) => (
          <Version key={v.version} v={v} />
        ))}
      </GroupBox>
      {more ? (
        <div className="sync-more">
          <Button size="small" disabled={busy} onClick={() => page(list.at(-1)?.version)}>
            {t('加载更多')}
          </Button>
        </div>
      ) : null}
    </>
  )
}

/**
 * 同步面板 (plan §4): each Bot's replica and the version history of a force group. Group admins and a bot's owner
 * may join a left-out replica, settle its local edits or handle its conflict; `onSettings` (admins) leads to the mode
 * settings.
 */
export function SyncPanel({
  groupId,
  focusBotId = null,
  isAdmin = false,
  onSettings,
  onClose,
}: {
  groupId: string
  /** Highlighted and scrolled to, e.g. from a notification. */
  focusBotId?: string | null
  isAdmin?: boolean
  onSettings?: () => void
  onClose: () => void
}) {
  const { status, error, retry } = useSyncLoad({ id: groupId, mode: 'force' })
  const [tab, setTab] = useState<'replicas' | 'versions'>('replicas')
  return (
    <Dialog open width={640} title={t('同步状态')} onClose={onClose}>
      <div className="sync-panel">
        {status?.switching ? (
          <Alert
            variant="info"
            description={
              <>
                {t('正在切换为强制同步，等待基准 Bot 提交工作区文件…')}
                {isAdmin ? <div>{t('可在同步模式设置中切回分区模式以取消')}</div> : null}
              </>
            }
          />
        ) : null}
        {onSettings ? (
          <div className="sync-panel__head">
            <Button size="small" variant="plain" onClick={onSettings}>
              {t('同步模式设置')}
            </Button>
          </div>
        ) : null}
        <Tabs
          aria-label={t('同步状态')}
          items={[
            { value: 'replicas', label: t('各 Bot') },
            { value: 'versions', label: t('版本历史') },
          ]}
          value={tab}
          onChange={setTab}
        />
        {status ? (
          tab === 'replicas' ? (
            <Replicas status={status} isAdmin={isAdmin} focusBotId={focusBotId} />
          ) : (
            <Versions groupId={groupId} head={status.headVersion} />
          )
        ) : error ? (
          <EmptyState
            title={error}
            action={
              <Button size="small" onClick={retry}>
                {t('重试')}
              </Button>
            }
          />
        ) : (
          <Spinner />
        )}
      </div>
    </Dialog>
  )
}
