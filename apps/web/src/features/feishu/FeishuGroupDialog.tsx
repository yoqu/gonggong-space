import type { FeishuChatChoicesDto, GroupFromFeishuDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Button,
  Dialog,
  GroupBox,
  GroupRow,
  Input,
  PopUpButton,
  SegmentedControl,
  Spinner,
  toast,
} from '../../ui'
import '../groups/groups.css'
import { chatListNote } from './GroupFeishuTab'

/**
 * 从飞书群创建: a group of the current team bound to a Feishu chat the main app and I are in, with its users who
 * linked Feishu and the bots whose app is in it; or 关联到已有群, one I administer that has no Feishu chat yet.
 * `chatId` preselects the chat (the link on the main app's card).
 */
export function FeishuGroupDialog({ chatId: initial, onClose }: { chatId?: string; onClose: () => void }) {
  const { data, reload } = useGet<FeishuChatChoicesDto>('/feishu/chats')
  const navigate = useNavigate()
  const me = useSession((s) => s.user)
  const groups = useWorkspace((s) => s.groups)
  const [mode, setMode] = useState<'create' | 'link'>('create')
  const [chatId, setChatId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const chats = data?.chats ?? []
  const linkable = groups.filter(
    (g) => g.kind === 'group' && !g.feishu && g.members.some((m) => m.userId === me?.id && m.isAdmin),
  )

  const pick = (id: string | null) => {
    setChatId(id)
    const chat = chats.find((c) => c.chatId === id)
    if (chat) setName(chat.name.slice(0, 60))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: preselects once, when the list arrives
  useEffect(() => {
    if (initial && data) pick(initial)
  }, [data])

  const link = async () => {
    setCreating(true)
    try {
      await api.put(`/groups/${groupId}/feishu`, { chatId })
      toast({ type: 'success', message: t('已关联飞书群') })
      onClose()
      navigate(`/g/${groupId}`)
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }

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
          {mode === 'create' ? (
            <Button
              variant="primary"
              disabled={!chatId || !name.trim() || creating}
              onClick={() => void submit()}
            >
              {t('创建')}
            </Button>
          ) : (
            <Button variant="primary" disabled={!chatId || !groupId || creating} onClick={() => void link()}>
              {t('关联')}
            </Button>
          )}
        </>
      }
    >
      {!data ? (
        <Spinner />
      ) : !data.available ? (
        <div className="gs-note">{t('系统管理员尚未接入飞书，暂不能关联飞书群。')}</div>
      ) : (
        <>
          <SegmentedControl
            aria-label={t('接入方式')}
            value={mode}
            onChange={setMode}
            items={[
              { value: 'create', label: t('新建共工群') },
              { value: 'link', label: t('关联到已有群') },
            ]}
          />
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
            {mode === 'create' ? (
              <GroupRow label={t('名称')}>
                <Input
                  aria-label={t('名称')}
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                />
              </GroupRow>
            ) : (
              <GroupRow label={t('共工群')} description={t('你是群管理员、还没关联飞书群的群')}>
                <PopUpButton
                  aria-label={t('共工群')}
                  placeholder={linkable.length ? t('选择共工群') : t('没有可关联的共工群')}
                  disabled={!linkable.length}
                  value={groupId}
                  options={linkable.map((g) => ({ value: g.id, label: g.name }))}
                  onChange={setGroupId}
                />
              </GroupRow>
            )}
          </GroupBox>
          {initial && !chats.some((c) => c.chatId === initial) ? (
            <div className="gs-note">{t('卡片里的飞书群你不在其中或已关联其他群')}</div>
          ) : null}
          <div className="gs-note">
            {mode === 'create'
              ? t('你是群管理员；飞书群里已绑定飞书账号的本团队成员和已在群里的 Bot 会一起加入。')
              : t('飞书群里已绑定飞书账号的本团队成员会加入该群，该群的 Bot 会被拉进飞书群。')}
          </div>
          <div className="gs-note">{chatListNote(data.mainAppName)}</div>
        </>
      )}
    </Dialog>
  )
}
