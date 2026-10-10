import type { BotDto, UserBriefDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, Form, FormRow, IconButton } from '../../ui'
import { MemberPicker } from '../groups/pickers'
import { botsApi } from './model'

/** 共享 tab: who may DM the bot and see its details; each change is saved at once. */
export function BotShares({ bot, users }: { bot: BotDto; users: UserBriefDto[] }) {
  const [busy, setBusy] = useState(false)
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? '--'
  const save = async (userIds: string[]) => {
    setBusy(true)
    try {
      await botsApi.share(bot.id, userIds)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Form>
      <FormRow
        label={t('共享给')}
        align="top"
        hint={t(
          '对方可以和 Bot 私聊、查看它的配置，每个私聊使用独立的托管工作区，命令审批仍由 Bot 主人处理；取消共享后对方的私聊转为只读。即时生效',
        )}
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
                  onClick={() => void save(bot.sharedWith.filter((x) => x !== id))}
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
          onAdd={(ids) => void save([...bot.sharedWith, ...ids])}
        />
      </FormRow>
    </Form>
  )
}
