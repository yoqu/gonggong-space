import type { FeishuMemberSyncDto, GroupDto, GroupFeishuView } from '@gonggong/protocol'
import { useState } from 'react'
import { locale, t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Button,
  ConfirmActionDialog,
  GroupBox,
  GroupRow,
  PopUpButton,
  Spinner,
  Switch,
  Tag,
  toast,
} from '../../ui'

const list = (names: string[]) => names.join(locale === 'en' ? ', ' : '、')

/** Who a created chat pulls in and who it leaves out (unlinked members, bots without an app). */
function createConsequences(v: GroupFeishuView) {
  const joined = [...v.members.filter((m) => m.linked), ...v.bots.filter((b) => b.appId)].map((x) => x.name)
  const unlinked = v.members.filter((m) => !m.linked).map((m) => m.name)
  const noApp = v.bots.filter((b) => !b.appId).map((b) => b.name)
  return [
    t('拉入：{names}', { names: list(joined) }),
    ...(unlinked.length ? [t('未绑定飞书账号，不会拉入：{names}', { names: list(unlinked) })] : []),
    ...(noApp.length ? [t('没有飞书应用，不会拉入：{names}', { names: list(noApp) })] : []),
    t('你是群主，之后在本群添加的成员也会被拉进飞书群'),
  ]
}

/** 群设置 · 飞书: bind the group to one Feishu chat of the main app; bots need their own app in that chat. */
export function GroupFeishuTab({ group }: { group: GroupDto }) {
  const path = `/groups/${group.id}/feishu`
  const { data, reload } = useGet<GroupFeishuView>(path)
  const [chatId, setChatId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [creating, setCreating] = useState(false)

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

  // Bots that could not be added on binding are left to 拉入飞书群 below: say so instead of a plain success.
  const bind = async () => {
    setBusy(true)
    try {
      const v = await api.put<GroupFeishuView>(path, { chatId })
      reload()
      const out = v.bots.filter((b) => b.appId && !b.inChat).length
      toast(
        out
          ? {
              type: 'info',
              message: t('已绑定飞书群 · {n} 个 Bot 未入群，请在下方点「拉入飞书群」', { n: out }),
            }
          : { type: 'success', message: t('已绑定飞书群') },
      )
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const syncMembers = async () => {
    setBusy(true)
    try {
      const r = await api.post<FeishuMemberSyncDto>(`${path}/sync-members`, {})
      toast({
        type: 'success',
        message:
          r.skippedUnlinked || r.skippedNotInTeam
            ? t('新加入 {n} 人；{unlinked} 人未注册共工，{outside} 人不在本团队', {
                n: r.added,
                unlinked: r.skippedUnlinked,
                outside: r.skippedNotInTeam,
              })
            : t('新加入 {n} 人', { n: r.added }),
      })
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
      <div className="gs-note">{t('绑定后，成员在飞书群里 @Bot 即可使用；Bot 的回复会发回飞书群。')}</div>
      <div className="gs-note">
        {t(
          '成员自动同步：飞书群里已绑定飞书账号的团队成员会加入本群，退出飞书群即移出本群；在本群添加的成员也会被拉进飞书群。',
        )}
      </div>
      <GroupBox>
        {data.chat ? (
          <>
            <GroupRow label={t('飞书群')} description={t('一个共工群只能绑定一个飞书群')}>
              <span className="gs-value">{data.chat.name}</span>
              <Button disabled={busy} onClick={() => setUnbinding(true)}>
                {t('解绑#feishu')}
              </Button>
            </GroupRow>
            <GroupRow
              label={t('网页消息同步到飞书群')}
              description={t(
                '关闭后，网页上发的消息、定时任务消息及其 Bot 回复和预览卡片不再发到飞书群；飞书群里的消息照常同步到本群',
              )}
            >
              <Switch
                ariaLabel={t('网页消息同步到飞书群')}
                checked={data.chat.syncOutbound}
                disabled={busy}
                onChange={(syncOutbound) =>
                  void run(
                    () => api.patch(path, { syncOutbound }),
                    syncOutbound ? t('已开启同步到飞书群') : t('已关闭同步到飞书群'),
                  )
                }
              />
            </GroupRow>
            <GroupRow
              label={t('同步全部飞书消息')}
              description={t(
                '开启后，飞书群里的普通消息也会同步到本群（只进不出，不触发 Bot）；没有共工账号的人发言也会保存到本群，以飞书昵称显示。关闭后只同步 @Bot 的消息',
              )}
            >
              <Switch
                ariaLabel={t('同步全部飞书消息')}
                checked={data.chat.syncAll}
                disabled={busy}
                onChange={(syncAll) =>
                  void run(
                    () => api.patch(path, { syncAll }),
                    syncAll ? t('已开启同步全部飞书消息') : t('已关闭同步全部飞书消息'),
                  )
                }
              />
            </GroupRow>
            <GroupRow
              label={t('群成员')}
              description={t('把飞书群里已注册共工的本团队成员补进本群，用于补上后来才注册或入团队的人')}
            >
              <Button disabled={busy} onClick={() => void syncMembers()}>
                {t('同步飞书群成员')}
              </Button>
            </GroupRow>
            {group.name !== data.chat.name ? (
              <GroupRow
                label={t('群名称')}
                description={t('与飞书群名「{name}」不一致，改成一样便于两边对应', { name: data.chat.name })}
              >
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.patch(`/groups/${group.id}`, { name: data.chat?.name.slice(0, 60) }),
                      t('已改为飞书群名称'),
                    )
                  }
                >
                  {t('改为飞书群名')}
                </Button>
              </GroupRow>
            ) : null}
          </>
        ) : (
          <GroupRow label={t('飞书群')} description={t('列出主应用和你都在、尚未绑定的飞书群')}>
            <PopUpButton
              aria-label={t('飞书群')}
              placeholder={data.chats.length ? t('选择飞书群') : t('没有可绑定的飞书群')}
              disabled={!data.chats.length}
              value={chatId}
              options={data.chats.map((c) => ({ value: c.chatId, label: c.name }))}
              onChange={setChatId}
            />
            <Button variant="primary" disabled={!chatId || busy} onClick={() => void bind()}>
              {t('绑定#verb')}
            </Button>
          </GroupRow>
        )}
        {data.chat ? null : (
          <GroupRow
            label={t('新建飞书群')}
            description={t('用本群名称新建飞书群并绑定，拉入已绑定飞书的成员和 Bot')}
          >
            <Button disabled={busy} onClick={() => setCreating(true)}>
              {t('创建飞书群')}
            </Button>
          </GroupRow>
        )}
      </GroupBox>
      {data.chat ? null : (
        <div className="gs-note">{t('找不到群？请先把主应用拉进飞书群；已被其他群绑定的不显示')}</div>
      )}
      {data.chat && data.bots.some((b) => b.appId && !b.inChat) ? (
        <div className="gs-note">
          {t(
            '未入群的 Bot 回复不会同步到飞书群，请点「拉入飞书群」。拉不进时，请检查主应用是否有群成员权限、飞书群是否允许添加机器人、该 Bot 的飞书应用是否已发布。',
          )}
        </div>
      ) : null}
      {data.chat && data.bots.length ? (
        <GroupBox>
          {data.bots.map((b) => (
            <GroupRow
              key={b.botId}
              label={b.name}
              description={b.appId && !b.inChat ? t('未在飞书群 · 回复不会同步到飞书') : undefined}
            >
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
      {creating && !data.chat ? (
        <ConfirmActionDialog
          title={t('创建飞书群')}
          message={t('确定新建飞书群「{name}」并绑定到本群？', { name: group.name })}
          consequences={createConsequences(data)}
          label={t('创建')}
          done={t('已创建并绑定飞书群')}
          run={() => api.post(`${path}/chat`, {})}
          onDone={() => {
            setCreating(false)
            reload()
          }}
          onClose={() => setCreating(false)}
        />
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
