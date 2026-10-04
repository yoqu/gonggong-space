import type { SyncReplicaDto, SyncStatusDto, SyncVersionDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { ago } from '../../lib/time'
import { Button, Dialog, EmptyState, GroupBox, Tabs, Tag } from '../../ui'
import { STATE, TAG } from './model'
import { syncApi, useSyncStatus, VERSIONS_PAGE } from './store'
import './sync.css'

const FILES_SHOWN = 3

function Replica({ r }: { r: SyncReplicaDto }) {
  const state = STATE[r.state]
  return (
    <div className="sync-row" data-testid={`replica-${r.botId}`}>
      <span className="sync-row__main">
        <span className="sync-row__title">
          <span>{r.botName}</span>
          {r.machineName ? <span className="sync-muted">{r.machineName}</span> : null}
        </span>
        {r.reason ? <span className="sync-muted">{r.reason}</span> : null}
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
    </div>
  )
}

function Replicas({ status }: { status: SyncStatusDto }) {
  return status.replicas.length ? (
    <GroupBox>
      {status.replicas.map((r) => (
        <Replica key={r.botId} r={r} />
      ))}
    </GroupBox>
  ) : (
    <EmptyState title={t('还没有副本')} />
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

/** 同步面板 (plan §4): each Bot's replica and the version history of a force group. */
export function SyncPanel({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const status = useSyncStatus({ id: groupId, mode: 'force' })
  const [tab, setTab] = useState<'replicas' | 'versions'>('replicas')
  return (
    <Dialog open width={640} title={t('同步状态')} onClose={onClose}>
      <div className="sync-panel">
        <Tabs
          aria-label={t('同步状态')}
          items={[
            { value: 'replicas', label: t('副本') },
            { value: 'versions', label: t('版本历史') },
          ]}
          value={tab}
          onChange={setTab}
        />
        {status ? (
          tab === 'replicas' ? (
            <Replicas status={status} />
          ) : (
            <Versions groupId={groupId} head={status.headVersion} />
          )
        ) : null}
      </div>
    </Dialog>
  )
}
