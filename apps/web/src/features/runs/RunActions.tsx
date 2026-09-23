import { DEFAULT_OFFLINE_WAIT_MIN, type RunDto, type RunStatus } from '@aiws/protocol'
import { OctagonX, Square, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { toast } from '../../ui'
import './runs.css'

const STOPPABLE: RunStatus[] = ['queued', 'running', 'awaiting_approval', 'awaiting_answer']

/** Group member name, for cards that only carry user ids. */
export const useMemberName = (groupId: string, userId: string | null) =>
  useWorkspace(
    (s) => s.groups.find((g) => g.id === groupId)?.members.find((m) => m.userId === userId)?.name ?? '—',
  )

const pad = (n: number) => String(n).padStart(2, '0')

/** Card actions of plan D7: /stop for a run, 终止整条链 for relay hops; offline requests show their expiry instead. */
export function RunActions({ run }: { run: RunDto }) {
  const [busy, setBusy] = useState(false)
  if (run.status === 'offline_wait') return <OfflineNote run={run} />
  if (!STOPPABLE.includes(run.status)) return null
  const chain = run.hop > 1
  const stop = async () => {
    setBusy(true)
    try {
      await api.post(`/runs/${run.id}/${chain ? 'stop-chain' : 'stop'}`, {})
    } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="run-actions">
      {chain ? (
        <button
          type="button"
          className="run-actions__btn run-actions__btn--danger"
          disabled={busy}
          onClick={stop}
        >
          <OctagonX size={12} />
          终止整条链
        </button>
      ) : (
        <button type="button" className="run-actions__btn" disabled={busy} onClick={stop}>
          <Square size={11} />
          /stop
        </button>
      )}
    </div>
  )
}

function OfflineNote({ run }: { run: RunDto }) {
  const trigger = useMemberName(run.groupId, run.triggerUserId ?? run.originUserId)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, Date.parse(run.queuedAt) + DEFAULT_OFFLINE_WAIT_MIN * 60_000 - now)
  const s = Math.floor(left / 1000)
  return (
    <div className="run-note">
      <WifiOff size={12} />
      {`bot 离线，已进入本机队列 · 上线后自动执行，${pad(Math.floor(s / 60))}:${pad(s % 60)} 后作废并通知 ${trigger}`}
    </div>
  )
}
