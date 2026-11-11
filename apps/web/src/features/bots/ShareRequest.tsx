import type { BotDto, BotShareRequestDto, GroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Button, Dialog, Input, Tag } from '../../ui'

/** Opens the caller's DM with the bot, starting one when there is none. */
export function useDm(bot: BotDto | null) {
  const navigate = useNavigate()
  const dm = useWorkspace((s) =>
    s.groups.find((g) => g.kind === 'dm' && g.botIds.length === 1 && g.botIds[0] === bot?.id),
  )
  return async () => {
    if (!bot) return
    if (dm) return navigate(`/g/${dm.id}`)
    try {
      const group = await api.post<GroupDto>('/groups', {
        name: bot.name,
        kind: 'dm',
        memberIds: [],
        botIds: [bot.id],
        repo: null,
      })
      useWorkspace.getState().applyEvent({ t: 'group.updated', group })
      navigate(`/g/${group.id}`)
    } catch (e) {
      toastError(e)
    }
  }
}

/** Someone else's bot: 私聊 once it is shared with me, 等待主人同意 while asked, else 申请共享. */
export function ShareRequestAction({ bot }: { bot: BotDto }) {
  const me = useSession((s) => s.user)
  const shared = !!me && bot.sharedWith.includes(me.id)
  const mine = bot.ownerId === me?.id
  const { data, reload } = useGet<BotShareRequestDto[]>(
    mine || shared ? null : `/bots/${bot.id}/share-requests`,
  )
  const openDm = useDm(bot)
  const [asking, setAsking] = useState(false)
  if (mine) return null
  if (shared)
    return (
      <Button size="small" onClick={() => void openDm()}>
        {t('私聊#chat')}
      </Button>
    )
  if (!data) return null
  if (data.length) return <Tag tone="gray">{t('等待主人同意')}</Tag>
  return (
    <>
      <Button size="small" onClick={() => setAsking(true)}>
        {t('申请共享')}
      </Button>
      {asking ? <AskDialog bot={bot} onClose={() => setAsking(false)} onDone={reload} /> : null}
    </>
  )
}

function AskDialog({ bot, onClose, onDone }: { bot: BotDto; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.post(`/bots/${bot.id}/share-requests`, { reason: reason.trim() })
      onDone()
      onClose()
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      width={440}
      title={t('申请共享 {name}', { name: bot.name })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {t('提交申请')}
          </Button>
        </>
      }
    >
      <div className="share-ask">
        <Input
          aria-label={t('用途')}
          placeholder={t('一句话说明用途（可选）')}
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="share-ask__note">
          {t(
            '{owner} 同意后会为你打开和 {name} 的私聊。私聊使用你单独的托管工作区，命令审批仍由 Bot 主人处理。',
            { owner: bot.ownerName, name: bot.name },
          )}
        </p>
      </div>
    </Dialog>
  )
}

/** The owner's pending 申请共享 with 同意 / 拒绝; hidden when there is none. */
export function ShareRequestList({ bot, onChange }: { bot: BotDto; onChange?: () => void }) {
  const { data, reload } = useGet<BotShareRequestDto[]>(`/bots/${bot.id}/share-requests`)
  const [busy, setBusy] = useState(false)
  if (!data?.length) return null
  const decide = async (r: BotShareRequestDto, verb: 'approve' | 'reject') => {
    setBusy(true)
    try {
      await api.post(`/share-requests/${r.id}/${verb}`, {})
      reload()
      onChange?.()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <ul className="bot-shares" aria-label={t('共享申请')}>
      {data.map((r) => (
        <li key={r.id} className="bot-shares__row">
          <span className="share-req__who">
            <span>{r.userName}</span>
            {r.reason ? <span className="share-req__reason">{r.reason}</span> : null}
          </span>
          <Button size="small" variant="primary" disabled={busy} onClick={() => void decide(r, 'approve')}>
            {t('同意')}
          </Button>
          <Button size="small" disabled={busy} onClick={() => void decide(r, 'reject')}>
            {t('拒绝#reject')}
          </Button>
        </li>
      ))}
    </ul>
  )
}
