import type { BotDto, UserBriefDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { AlertDialog, Button, Form, FormRow, IconButton, Presence, toast } from '../../ui'
import { MemberPicker } from '../groups/pickers'
import { botsApi } from './model'
import { ShareRequestList } from './ShareRequest'

/** 共享 tab: who may DM the bot and see its details; each change is saved at once. */
export function BotShares({ bot, users }: { bot: BotDto; users: UserBriefDto[] }) {
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? '--'
  const save = async (userIds: string[]) => {
    setBusy(true)
    try {
      await botsApi.share(bot.id, userIds)
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  const confirmRemove = async () => {
    if (!removing || busy) return
    if (await save(bot.sharedWith.filter((x) => x !== removing))) {
      toast({ type: 'success', message: t('已取消共享') })
      setRemoving(null)
    }
  }
  return (
    <Form>
      <FormRow
        label={t('共享给')}
        align="top"
        hint={
          <>
            {t(
              '对方可以和 Bot 私聊、查看它的配置，每个私聊使用独立的托管工作区，命令审批仍由 Bot 主人处理；取消共享后对方的私聊转为只读。',
            )}
            <span style={{ display: 'block' }}>{t('本页修改即时生效，无需点击底部「保存」。')}</span>
          </>
        }
      >
        {bot.sharedWith.length ? (
          <ul className="bot-shares" aria-label={t('共享对象')}>
            {bot.sharedWith.map((id) => (
              <li key={id} className="bot-shares__row">
                <span>{name(id)}</span>
                <IconButton
                  size="small"
                  title={t('移除 {name}', { name: name(id) })}
                  disabled={busy}
                  onClick={() => setRemoving(id)}
                >
                  {'minus' as const}
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <span className="bots-detail__unset">{t('还没有共享给任何人')}</span>
        )}
        <MemberPicker
          trigger={
            <Button size="small" disabled={busy}>
              {t('添加成员…')}
            </Button>
          }
          users={users.filter((u) => u.id !== bot.ownerId && !bot.sharedWith.includes(u.id))}
          onAdd={(ids) =>
            void save([...bot.sharedWith, ...ids]).then(
              (ok) => ok && toast({ type: 'success', message: t('已添加共享成员') }),
            )
          }
        />
      </FormRow>
      <ShareRequestList bot={bot} />
      <Presence>
        {removing ? (
          <AlertDialog
            open
            title={t('要取消与 {name} 共享「{bot}」吗？', { name: name(removing), bot: bot.name })}
            message={t('取消后，对方与该 Bot 的私聊会转为只读，历史记录保留。随时可以重新共享。')}
            onClose={() => {
              if (!busy) setRemoving(null)
            }}
            actions={[
              { label: t('取消'), disabled: busy, onClick: () => setRemoving(null) },
              {
                label: t('取消共享'),
                variant: 'destructive',
                disabled: busy,
                loading: busy,
                onClick: () => void confirmRemove(),
              },
            ]}
          />
        ) : null}
      </Presence>
    </Form>
  )
}
