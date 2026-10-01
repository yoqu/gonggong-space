import type { GroupDto, GroupFeishuView } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Button, ConfirmActionDialog, GroupBox, GroupRow, PopUpButton, Spinner, Tag, toast } from '../../ui'

/** 群设置 · 飞书: bind the group to one Feishu chat of the main app; bots need their own app in that chat. */
export function GroupFeishuTab({ group }: { group: GroupDto }) {
  const path = `/groups/${group.id}/feishu`
  const { data, reload } = useGet<GroupFeishuView>(path)
  const [chatId, setChatId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unbinding, setUnbinding] = useState(false)

  const run = async (call: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await call()
      reload()
      toast({ type: 'success', message: done })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <Spinner />
  if (!data.available)
    return <div className="gs-note">{t('系统管理员尚未配置飞书主应用，暂不能绑定飞书群。')}</div>

  return (
    <>
      <div className="gs-note">
        {t('绑定后，成员在飞书群里 @Bot 即可使用；只同步发给 Bot 的消息和 Bot 的回复。')}
      </div>
      <GroupBox>
        {data.chat ? (
          <GroupRow label={t('飞书群')} description={t('一个共工群只能绑定一个飞书群')}>
            <span className="gs-value">{data.chat.name}</span>
            <Button disabled={busy} onClick={() => setUnbinding(true)}>
              {t('解绑#feishu')}
            </Button>
          </GroupRow>
        ) : (
          <GroupRow label={t('飞书群')} description={t('列出主应用所在尚未绑定的飞书群')}>
            <PopUpButton
              aria-label={t('飞书群')}
              placeholder={data.chats.length ? t('选择飞书群') : t('没有可绑定的飞书群')}
              disabled={!data.chats.length}
              value={chatId}
              options={data.chats.map((c) => ({ value: c.chatId, label: c.name }))}
              onChange={setChatId}
            />
            <Button
              variant="primary"
              disabled={!chatId || busy}
              onClick={() => void run(() => api.put(path, { chatId }), t('已绑定飞书群'))}
            >
              {t('绑定#verb')}
            </Button>
          </GroupRow>
        )}
      </GroupBox>
      {data.chat && data.bots.length ? (
        <GroupBox>
          {data.bots.map((b) => (
            <GroupRow key={b.botId} label={b.name}>
              {!b.appId ? (
                <Tag tone="gray">{t('未绑定飞书应用')}</Tag>
              ) : b.inChat ? (
                <Tag tone="green">{t('已在群中')}</Tag>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => void run(() => api.post(`${path}/bots/${b.botId}`, {}), t('已拉入飞书群'))}
                >
                  {t('拉入飞书群')}
                </Button>
              )}
            </GroupRow>
          ))}
        </GroupBox>
      ) : null}
      {unbinding && data.chat ? (
        <ConfirmActionDialog
          title={t('解绑飞书群')}
          message={t('确定解绑飞书群 {name}？', { name: data.chat.name })}
          consequences={[t('飞书群里 @Bot 将不再触发运行'), t('已同步的消息保留')]}
          label={t('解绑#feishu')}
          done={t('已解绑飞书群')}
          run={() => api.del(path)}
          onDone={() => {
            setUnbinding(false)
            reload()
          }}
          onClose={() => setUnbinding(false)}
        />
      ) : null}
    </>
  )
}
