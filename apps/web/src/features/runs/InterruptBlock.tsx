import type { RunDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Button, toast } from '../../ui'
import { useMemberName } from './RunActions'

const TITLE = {
  pending: (n: number) => `已停止 · 本轮改动 ${n} 个文件留在工作区`,
  kept: () => '已保留本轮改动 · 留在工作区，未提交',
  discarded: () => '已丢弃本轮改动 · 之前已有的未提交内容不动',
}

/** Partition /stop leftovers (plan D7): edits stay by default; the initiator or the bot owner may discard them. */
export function InterruptBlock({ run }: { run: RunDto }) {
  const me = useSession((s) => s.user?.id)
  const ownerId = useWorkspace((s) => s.bots.find((b) => b.id === run.botId)?.ownerId)
  const initiator = useMemberName(run.groupId, run.originUserId)
  const [busy, setBusy] = useState(false)
  if (run.status !== 'interrupted' || !run.interrupt) return null
  const pending = run.interrupt === 'pending'
  const allowed = !!me && [run.triggerUserId, run.originUserId, ownerId].includes(me)
  const choose = async (choice: 'keep' | 'discard') => {
    setBusy(true)
    try {
      await api.post(`/runs/${run.id}/interrupt`, { choice })
    } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="run-interrupt">
      <div className="run-interrupt__title">{TITLE[run.interrupt](run.filesChanged)}</div>
      <div className="run-interrupt__desc">
        {pending
          ? `默认保留：不回滚、不自动提交、不 stash。丢弃只还原本轮触及的文件，不影响此前已有的未提交改动。仅发起人 ${initiator} 或 Bot 主人可选，无超时。`
          : '下一轮上下文会告诉 agent：上一轮被 /stop 中断，以及这些文件的当前状态。'}
      </div>
      {pending ? (
        <div className="run-interrupt__actions">
          <Button size="small" disabled={!allowed || busy} onClick={() => choose('keep')}>
            保留改动
          </Button>
          <Button
            size="small"
            variant="destructive"
            disabled={!allowed || busy}
            onClick={() => choose('discard')}
          >
            丢弃本轮改动
          </Button>
        </div>
      ) : null}
    </div>
  )
}
