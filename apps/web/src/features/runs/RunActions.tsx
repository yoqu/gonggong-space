import type { RunDto, RunStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useNow } from '../../lib/now'
import { countdown } from '../../lib/time'
import { Button, Dialog } from '../../ui'
import { useAppend } from './append'

const STOPPABLE: RunStatus[] = ['queued', 'running', 'awaiting_approval', 'awaiting_answer']
const APPENDABLE: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']

/** Group member name, for cards that only carry user ids. */
export const useMemberName = (groupId: string, userId: string | null) =>
  useWorkspace(
    (s) => s.groups.find((g) => g.id === groupId)?.members.find((m) => m.userId === userId)?.name ?? '—',
  )

/** Spec §8.9: the trigger user (chain initiator) or the bot owner may send the next message into a live run. */
function AppendAction({ run }: { run: RunDto }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const me = useSession((s) => s.user?.id)
  const start = useAppend((s) => s.start)
  if (!APPENDABLE.includes(run.status) || !bot || (me !== run.originUserId && me !== bot.ownerId)) return null
  return (
    <Button
      size="small"
      icon="arrow-turn-down-right"
      onClick={() => start({ runId: run.id, groupId: run.groupId, botName: bot.name })}
    >
      {t('打断并追加')}
    </Button>
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
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const stopAction = chain ? (
    <>
      <Button
        size="small"
        variant="destructive"
        icon="octagon-xmark"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {t('终止整条链')}
      </Button>
      <Dialog
        open={confirming}
        title={t('终止整条链')}
        onClose={() => setConfirming(false)}
        width={420}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{t('取消')}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void stop()}>
              {t('终止')}
            </Button>
          </>
        }
      >
        <ul className="ui-consequences">
          <li>{t('停止这条接力链上所有未完成的轮次')}</li>
          <li>{t('后续接力不再触发')}</li>
        </ul>
      </Dialog>
    </>
  ) : (
    <Button size="small" icon="stop" disabled={busy} onClick={stop}>
      {t('停止')}
    </Button>
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
  const left = Date.parse(run.queuedAt) + run.offlineWaitMin * 60_000 - useNow(true)
  return (
    <span>
      {t('Bot 离线，已进入本机队列 · 上线后自动执行，{time} 后作废并通知 {name}', {
        time: countdown(left),
        name: trigger,
      })}
    </span>
  )
}
