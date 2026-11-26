import type { RunDto, RunStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { useInspector } from '../../app/inspector'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useNow } from '../../lib/now'
import { countdown } from '../../lib/time'
import { AlertDialog, Button, Presence } from '../../ui'
import { useCanvasChat } from '../artifacts/chatRoot'
import { openThread } from '../chat/thread'
import { useAppend } from './append'

const STOPPABLE: RunStatus[] = ['queued', 'running', 'awaiting_approval', 'awaiting_answer']
const APPENDABLE: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']

/** Group member name, for cards that only carry user ids. */
export const useMemberName = (groupId: string, userId: string | null) =>
  useWorkspace(
    (s) => s.groups.find((g) => g.id === groupId)?.members.find((m) => m.userId === userId)?.name ?? '—',
  )

/** Brings up the composer of the run's thread: its 话题, unless already open or it is the canvas's AI 对话 in front. */
function showComposer(groupId: string, rootId: string) {
  const open = useInspector.getState()
  if (open.view === 'thread' && open.payload === rootId) return
  if (useCanvasChat.getState().byGroup[groupId]?.rootId === rootId) return
  openThread(rootId)
}

/** Spec §8.9: the trigger user (chain initiator) or the bot owner may send the next message into a live run. */
function AppendAction({ run }: { run: RunDto }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const me = useSession((s) => s.user?.id)
  const start = useAppend((s) => s.start)
  // A continuation has no prompt to interrupt: a message for it starts the next turn.
  if (
    !APPENDABLE.includes(run.status) ||
    run.stoppedBy ||
    run.continuationOf ||
    !bot ||
    (me !== run.originUserId && me !== bot.ownerId)
  )
    return null
  return (
    <Button
      size="small"
      icon="arrow-turn-down-right"
      onClick={() => {
        const threadRootId = run.threadRootId ?? undefined
        start({ runId: run.id, groupId: run.groupId, botName: bot.name, threadRootId })
        if (threadRootId) showComposer(run.groupId, threadRootId)
      }}
    >
      {t('打断并追加')}
    </Button>
  )
}

/** Card actions: 打断并追加 (spec §8.9), then 停止 for a run or 终止整条链 for relay hops (plan D7). */
export function RunActions({ run }: { run: RunDto }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const me = useSession((s) => s.user?.id)
  const botName = useWorkspace((s) => s.bots.find((b) => b.id === run.botId)?.name ?? '')
  const origin = useMemberName(run.groupId, run.originUserId)
  if (!STOPPABLE.includes(run.status)) return null
  const othersRun = !!run.originUserId && run.originUserId !== me
  const chain = run.hop > 1
  // Stopped but not yet wound down by the agent: the server ends it within its grace, so no second click.
  const stopping = !!run.stoppedBy
  const pending = stopping || (busy && !confirming)
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
        loading={stopping}
        onClick={() => setConfirming(true)}
      >
        {stopping ? t('正在停止…') : t('终止整条链')}
      </Button>
      <Presence>
        {confirming ? (
          <AlertDialog
            open
            title={t('要终止整条链吗？')}
            detail={
              <ul className="ui-consequences">
                <li>{t('停止这条接力链上所有未完成的轮次')}</li>
                <li>{t('后续接力不再触发')}</li>
              </ul>
            }
            onClose={() => {
              if (!busy) setConfirming(false)
            }}
            actions={[
              { label: t('取消'), disabled: busy, onClick: () => setConfirming(false) },
              {
                label: t('终止'),
                variant: 'destructive',
                disabled: busy,
                loading: busy,
                onClick: () => void stop(),
              },
            ]}
          />
        ) : null}
      </Presence>
    </>
  ) : (
    <>
      <Button
        size="small"
        icon="stop"
        disabled={busy}
        loading={pending}
        onClick={() => (othersRun ? setConfirming(true) : void stop())}
      >
        {pending ? t('正在停止…') : t('停止')}
      </Button>
      <Presence>
        {confirming ? (
          <AlertDialog
            open
            title={t('要停止 {bot} 的这轮运行吗？', { bot: botName })}
            message={
              run.status === 'queued'
                ? t('这是 {name} 发起的任务，还在排队；停止后不会开始运行。', { name: origin })
                : t('这是 {name} 发起的任务，当前轮次会在几秒内停止，已产生的改动会保留在工作区。', {
                    name: origin,
                  })
            }
            onClose={() => {
              if (!busy) setConfirming(false)
            }}
            actions={[
              { label: t('取消'), disabled: busy, onClick: () => setConfirming(false) },
              {
                label: t('停止'),
                variant: 'destructive',
                disabled: busy,
                loading: busy,
                onClick: () => void stop(),
              },
            ]}
          />
        ) : null}
      </Presence>
    </>
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
      {t('Bot 离线，已进入这台电脑的队列 · 上线后自动执行，{time} 后失效并通知 {name}', {
        time: countdown(left),
        name: trigger,
      })}
    </span>
  )
}
