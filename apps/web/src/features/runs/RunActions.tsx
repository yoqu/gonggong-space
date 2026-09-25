import type { RunDto, RunStatus } from '@gonggong/protocol'
import { CornerDownRight, OctagonX, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Button, Dialog, toast } from '../../ui'
import { useAppend } from './append'

const STOPPABLE: RunStatus[] = ['queued', 'running', 'awaiting_approval', 'awaiting_answer']
const APPENDABLE: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']

/** Group member name, for cards that only carry user ids. */
export const useMemberName = (groupId: string, userId: string | null) =>
  useWorkspace(
    (s) => s.groups.find((g) => g.id === groupId)?.members.find((m) => m.userId === userId)?.name ?? '—',
  )

const pad = (n: number) => String(n).padStart(2, '0')

/** Spec §8.9: the trigger user (chain initiator) or the bot owner may send the next message into a live run. */
function AppendAction({ run }: { run: RunDto }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const me = useSession((s) => s.user?.id)
  const start = useAppend((s) => s.start)
  if (!APPENDABLE.includes(run.status) || !bot || (me !== run.originUserId && me !== bot.ownerId)) return null
  return (
    <button
      type="button"
      className="run-card__action"
      onClick={() => start({ runId: run.id, groupId: run.groupId, botName: bot.name })}
    >
      <CornerDownRight size={12} />
      打断并追加
    </button>
  )
}

/** Card actions: 打断并追加 (spec §8.9), then 停止 for a run or 终止整条链 for relay hops (plan D7). */
export function RunActions({ run }: { run: RunDto }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  if (!STOPPABLE.includes(run.status)) return null
  const chain = run.hop > 1
  const stop = async () => {
    setBusy(true)
    try {
      await api.post(`/runs/${run.id}/${chain ? 'stop-chain' : 'stop'}`, {})
      setConfirming(false)
    } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const stopAction = chain ? (
    <>
      <button
        type="button"
        className="run-card__action run-card__action--danger"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        <OctagonX size={12} />
        终止整条链
      </button>
      <Dialog
        open={confirming}
        title="终止整条链"
        onClose={() => setConfirming(false)}
        width={420}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void stop()}>
              终止
            </Button>
          </>
        }
      >
        <ul className="ui-consequences">
          <li>停止这条接力链上所有未完成的轮次</li>
          <li>后续接力不再触发</li>
        </ul>
      </Dialog>
    </>
  ) : (
    <button type="button" className="run-card__action" disabled={busy} onClick={stop}>
      <Square size={11} />
      停止
    </button>
  )
  return (
    <>
      <AppendAction run={run} />
      {stopAction}
    </>
  )
}

/** Spec §4.8: an offline bot's request waits in its queue and expires (the trigger user is told). */
export function OfflineNote({ run }: { run: RunDto }) {
  const trigger = useMemberName(run.groupId, run.triggerUserId ?? run.originUserId)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.floor(Math.max(0, Date.parse(run.queuedAt) + run.offlineWaitMin * 60_000 - now) / 1000)
  return (
    <span>{`Bot 离线，已进入本机队列 · 上线后自动执行，${pad(Math.floor(s / 60))}:${pad(s % 60)} 后作废并通知 ${trigger}`}</span>
  )
}
