import type { FeishuChatChoicesDto, GroupFromFeishuDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Button, Dialog, GroupBox, GroupRow, Input, PopUpButton, Spinner, toast } from '../../ui'
import '../groups/groups.css'
import { chatListNote } from './GroupFeishuTab'

/**
 * 从飞书群创建: a group of the current team bound to a Feishu chat the main app and I are in, with its users who
 * linked Feishu and the bots whose app is in it. `chatId` preselects the chat (the link on the main app's card).
 */
export function FeishuGroupDialog({ chatId: initial, onClose }: { chatId?: string; onClose: () => void }) {
  const { data, reload } = useGet<FeishuChatChoicesDto>('/feishu/chats')
  const navigate = useNavigate()
  const [chatId, setChatId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const chats = data?.chats ?? []

  const pick = (id: string | null) => {
    setChatId(id)
    const chat = chats.find((c) => c.chatId === id)
    if (chat) setName(chat.name.slice(0, 60))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: preselects once, when the list arrives
  useEffect(() => {
    if (initial && data) pick(initial)
  }, [data])

  const submit = async () => {
    setCreating(true)
    try {
      const r = await api.post<GroupFromFeishuDto>('/groups/from-feishu', { chatId, name: name.trim() })
      useWorkspace.getState().applyEvent({ t: 'group.updated', group: r.group })
      toast({
        type: 'success',
        message:
          r.skippedUnlinked || r.skippedNotInTeam
            ? t('已创建并关联飞书群，拉入 {n} 人；{unlinked} 人未绑定飞书账号，{outside} 人不在本团队', {
                n: r.added,
                unlinked: r.skippedUnlinked,
                outside: r.skippedNotInTeam,
              })
            : t('已创建并关联飞书群，拉入 {n} 人', { n: r.added }),
      })
      onClose()
      navigate(`/g/${r.group.id}`)
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open
      width={480}
      closeOnBackdrop={false}
      title={t('从飞书群创建')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            variant="primary"
            disabled={!chatId || !name.trim() || creating}
            onClick={() => void submit()}
          >
            {t('创建')}
          </Button>
        </>
      }
    >
      {!data ? (
        <Spinner />
      ) : !data.available ? (
        <div className="gs-note">{t('系统管理员尚未接入飞书，暂不能关联飞书群。')}</div>
      ) : (
        <>
          <GroupBox>
            <GroupRow label={t('飞书群')} description={t('列出机器人和你都在、尚未关联的飞书群')}>
              <Button onClick={reload}>{t('刷新')}</Button>
              <PopUpButton
                aria-label={t('飞书群')}
                placeholder={chats.length ? t('选择飞书群') : t('没有可关联的飞书群')}
                disabled={!chats.length}
                value={chatId}
                options={chats.map((c) => ({ value: c.chatId, label: c.name }))}
                onChange={pick}
              />
            </GroupRow>
            <GroupRow label={t('名称')}>
              <Input
                aria-label={t('名称')}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </GroupRow>
          </GroupBox>
          {initial && !chats.some((c) => c.chatId === initial) ? (
            <div className="gs-note">{t('卡片里的飞书群你不在其中或已关联其他群')}</div>
          ) : null}
          <div className="gs-note">
            {t('你是群管理员；飞书群里已绑定飞书账号的本团队成员和已在群里的 Bot 会一起加入。')}
          </div>
          <div className="gs-note">{chatListNote(data.mainAppName)}</div>
        </>
      )}
    </Dialog>
  )
}
