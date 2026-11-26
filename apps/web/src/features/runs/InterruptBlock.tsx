import type { RunDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { AlertDialog, Button, Presence } from '../../ui'
import { useMemberName } from './RunActions'

const TITLE = {
  pending: (n: number) => t('已停止 · 本轮改动 {n} 个文件留在工作区', { n }),
  kept: () => t('已保留本轮改动 · 留在工作区，未提交'),
  discarded: () => t('已丢弃本轮改动 · 之前已有的未提交内容不动'),
}
const FORCE_TITLE = {
  pending: (n: number) => t('已停止 · 强制同步：本轮改动 {n} 个文件待处理，未提交', { n }),
  kept: () => t('已保留本轮改动 · 提交为一版'),
  discarded: () => t('已丢弃本轮改动 · 已备份并回滚到同步版本'),
}

/**
 * /stop leftovers: in a partition group (plan D7) edits stay by default and may be discarded; in a force group (F21)
 * they wait unsubmitted until kept (a version) or discarded. Only the initiator or the bot owner chooses.
 */
export function InterruptBlock({ run }: { run: RunDto }) {
  const me = useSession((s) => s.user?.id)
  const ownerId = useWorkspace((s) => s.bots.find((b) => b.id === run.botId)?.ownerId)
  const initiator = useMemberName(run.groupId, run.originUserId)
  const [busy, setBusy] = useState<'keep' | 'discard' | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const pending = run.status === 'interrupted' && run.interrupt === 'pending'
  useEffect(() => {
    if (!pending && confirmDiscard) setConfirmDiscard(false)
  }, [pending, confirmDiscard])
  if (run.status !== 'interrupted' || !run.interrupt) return null
  const force = run.sync?.outcome === 'stopped' ? run.sync : null
  const allowed = !!me && [run.triggerUserId, run.originUserId, ownerId].includes(me)
  const choose = async (choice: 'keep' | 'discard') => {
    if (busy) return
    setBusy(choice)
    try {
      await api.post(`/runs/${run.id}/interrupt`, { choice })
      if (choice === 'discard') setConfirmDiscard(false)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="run-interrupt">
      <div className="run-interrupt__title">
        {force ? FORCE_TITLE[run.interrupt](force.files) : TITLE[run.interrupt](run.filesChanged)}
      </div>
      <div className="run-interrupt__desc">
        {pending && force
          ? t(
              '保留即提交为一版（标「中断」）；丢弃先备份，再回滚到同步版本。处理前该 Bot 在本群的新触发排队。仅发起人 {name} 或 Bot 主人可选，无超时。',
              { name: initiator },
            )
          : pending
            ? t(
                '默认保留：不回滚、不自动提交、不 stash。丢弃只还原本轮触及的文件，不影响此前已有的未提交改动。仅发起人 {name} 或 Bot 主人可选，无超时。',
                { name: initiator },
              )
            : t('下一轮上下文会告诉 Agent：上一轮已被停止，以及这些文件的当前状态。')}
      </div>
      {pending ? (
        <div className="run-interrupt__actions">
          <Button
            size="small"
            disabled={!allowed || busy !== null}
            loading={busy === 'keep'}
            onClick={() => void choose('keep')}
          >
            {t('保留改动')}
          </Button>
          <Button
            size="small"
            variant="destructive"
            disabled={!allowed || busy !== null}
            onClick={() => setConfirmDiscard(true)}
          >
            {t('丢弃本轮改动')}
          </Button>
        </div>
      ) : null}
      <Presence>
        {confirmDiscard ? (
          <AlertDialog
            open
            title={t('要丢弃本轮未提交的改动吗？')}
            message={
              force
                ? t('丢弃后会先保存本地备份，再将工作区回滚到同步版本。')
                : t('工作区里本轮触及的文件将还原到运行前状态，不影响此前已有的未提交改动。')
            }
            onClose={() => {
              if (busy !== 'discard') setConfirmDiscard(false)
            }}
            actions={[
              { label: t('取消'), disabled: busy === 'discard', onClick: () => setConfirmDiscard(false) },
              {
                label: t('丢弃改动'),
                variant: 'destructive',
                disabled: busy === 'discard',
                loading: busy === 'discard',
                onClick: () => void choose('discard'),
              },
            ]}
          />
        ) : null}
      </Presence>
    </div>
  )
}
