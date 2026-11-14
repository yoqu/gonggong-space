import type { BotDto, FeishuIssue, FeishuMemberSyncDto, GroupDto, GroupFeishuView } from '@gonggong/protocol'
import { useState } from 'react'
import { Link } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { locale, t } from '../../i18n'
import { ApiError, api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  GroupBox,
  GroupRow,
  PopUpButton,
  Presence,
  RadioGroup,
  Spinner,
  Switch,
  Tag,
  toast,
} from '../../ui'
import { BotDialog } from '../bots/BotDialog'
import { feishuHintText } from './FeishuIssueEvent'
import { feishuStartUrl } from './login'

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

/** Why the picker may miss a chat: it lists only those the main app's bot is in. */
export const chatListNote = (mainAppName: string | null) =>
  mainAppName
    ? t('只列出「{name}」机器人已加入的群；看不到的群，请在飞书群设置 › 群机器人里添加它后点刷新', {
        name: mainAppName,
      })
    : t('只列出共工机器人已加入的群；看不到的群，请在飞书群设置 › 群机器人里添加它后点刷新')

/** The main app's bot as members know it in Feishu. */
const botLabel = (mainAppName: string | null) =>
  mainAppName ? t('「{name}」机器人', { name: mainAppName }) : t('共工机器人')

const useSysadmin = () => useSession((s) => s.user)?.role === 'sysadmin'

/** Feishu could not be read (secret revoked, Feishu unreachable): say why and retry; a sysadmin can go fix it. */
export function FeishuLoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const admin = useSysadmin()
  return (
    <Alert variant="error" description={t('读取飞书群信息失败：{reason}', { reason: error })}>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button size="sm" onClick={onRetry}>
          {t('重试')}
        </Button>
        {admin ? <Link to="/admin/feishu">{t('去管理后台检查飞书')}</Link> : null}
      </div>
    </Alert>
  )
}

/** The main app cannot read the bound chat: the settings below still work, Feishu-side ones may not. */
function FeishuCallError({ issue }: { issue: FeishuIssue }) {
  const admin = useSysadmin()
  return (
    <Alert
      variant="error"
      description={
        <>
          {t('飞书调用失败：{reason}', { reason: feishuHintText(issue.code) })}
          <span className="feishu-issue__code" title={issue.message}>
            {t('飞书错误码 {code}', { code: issue.code })}
          </span>
          {admin ? (
            <>
              {' '}
              <Link to="/admin/feishu">{t('去管理后台检查飞书')}</Link>
            </>
          ) : null}
        </>
      }
    />
  )
}

/** The main app is not configured yet; a sysadmin is pointed at where to do it. */
export function FeishuUnavailableNote() {
  const admin = useSysadmin()
  return (
    <div className="gs-note">
      {t('系统管理员尚未接入飞书，暂不能关联飞书群。')}
      {admin ? (
        <>
          {' '}
          <Link to="/admin/feishu">{t('去管理后台接入')}</Link>
        </>
      ) : null}
    </div>
  )
}

/**
 * 群设置 · 飞书: link the group to one Feishu chat of the main app; bots need their own app in that chat. Unlinked, it
 * shows what linking needs first (my Feishu account, the bot in the chat), then the chats to pick, then creating one.
 */
export function GroupFeishuTab({ group }: { group: GroupDto }) {
  const path = `/groups/${group.id}/feishu`
  const { data, error, reload } = useGet<GroupFeishuView>(path)
  const me = useSession((s) => s.user)
  const bots = useWorkspace((s) => s.bots)
  const [connecting, setConnecting] = useState<BotDto | null>(null)
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

  // Bots and members are pulled in on binding; a bot Feishu refused is listed below with why and a retry.
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
              message: t('已关联飞书群 · {n} 个 Bot 没能拉入，原因见下方', { n: out }),
            }
          : { type: 'success', message: t('已关联飞书群') },
      )
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  // A failed retry still reloads: the bot's row shows Feishu's latest reason.
  const pullBot = async (botId: string) => {
    setBusy(true)
    try {
      await api.post(`${path}/bots/${botId}`, {})
      toast({ type: 'success', message: t('已拉入飞书群') })
    } catch (e) {
      // Feishu's refusal (400) is kept on the bot's row; saying it again here would fill the screen.
      if (e instanceof ApiError && e.status === 400)
        toast({ type: 'error', message: t('没能拉入，原因见列表') })
      else toastError(e)
    } finally {
      reload()
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

  if (!data) return error ? <FeishuLoadError error={error} onRetry={reload} /> : <Spinner />
  if (!data.available) return <FeishuUnavailableNote />

  const linked = data.members.find((m) => m.userId === me?.id)?.linked ?? false
  const manages = (botId: string) => {
    const bot = bots.find((b) => b.id === botId)
    return bot && me && (bot.ownerId === me.id || me.role === 'sysadmin') ? bot : null
  }

  return (
    <>
      {data.feishuError ? <FeishuCallError issue={data.feishuError} /> : null}
      {data.chat ? (
        <>
          <GroupBox>
            <GroupRow label={t('飞书群')} description={t('一个共工群只能关联一个飞书群')}>
              <span className="gs-value">{data.chat.name}</span>
              <Button disabled={busy} onClick={() => setUnbinding(true)}>
                {t('取消关联')}
              </Button>
            </GroupRow>
            <GroupRow
              label={t('群成员')}
              description={t(
                '飞书群里已绑定飞书账号的团队成员会自动加入本群，退出飞书群即移出本群；在本群添加的成员也会被拉进飞书群。后来才注册或入团队的人，点「同步飞书群成员」补上',
              )}
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
          </GroupBox>
          <h3 className="feishu-section">{t('共工 → 飞书')}</h3>
          <GroupBox>
            <GroupRow
              label={t('网页消息发到飞书群')}
              description={t(
                '网页上发的消息、定时任务消息及其 Bot 回复和预览卡片发到飞书群。关闭后只在共工里看得到',
              )}
            >
              <Switch
                ariaLabel={t('网页消息发到飞书群')}
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
          </GroupBox>
          <h3 className="feishu-section">{t('飞书 → 共工')}</h3>
          <GroupBox>
            <GroupRow
              label={t('同步哪些飞书消息')}
              description={t(
                '同步全部消息时，普通消息只进不出、不触发 Bot；没有共工账号的人发言也会保存到本群，以飞书昵称显示',
              )}
            >
              <RadioGroup
                aria-label={t('同步哪些飞书消息')}
                value={data.chat.syncAll ? 'all' : 'mentions'}
                disabled={busy}
                options={[
                  { value: 'mentions', label: t('只同步 @Bot 的消息') },
                  { value: 'all', label: t('同步全部消息') },
                ]}
                onChange={(v) => {
                  const syncAll = v === 'all'
                  void run(
                    () => api.patch(path, { syncAll }),
                    syncAll ? t('已开启同步全部飞书消息') : t('已关闭同步全部飞书消息'),
                  )
                }}
              />
            </GroupRow>
          </GroupBox>
        </>
      ) : (
        <>
          <h3 className="feishu-section">{t('关联前先确认')}</h3>
          <GroupBox>
            <GroupRow
              label={t('绑定你的飞书账号')}
              description={t('只能关联你也在的飞书群，共工靠你的飞书账号确认')}
            >
              {linked ? (
                <Tag tone="green">{t('已绑定#feishu')}</Tag>
              ) : (
                <a
                  className="ui-btn ui-btn--small"
                  href={feishuStartUrl(location.pathname + location.search, 'link')}
                >
                  {t('绑定飞书账号')}
                </a>
              )}
            </GroupRow>
            <GroupRow
              label={t('把{bot}拉进飞书群', { bot: botLabel(data.mainAppName) })}
              description={t(
                '在飞书群设置 › 群机器人里添加。添加后群里会出现接入卡片，也可以直接点卡片完成关联',
              )}
            >
              {data.chats.length ? (
                <Tag tone="green">{t('已在群中')}</Tag>
              ) : data.mainAppName ? (
                <Button
                  size="small"
                  onClick={() =>
                    void copyText(data.mainAppName ?? '').then(
                      () => toast({ type: 'success', message: t('已复制机器人名') }),
                      toastError,
                    )
                  }
                >
                  {t('复制机器人名')}
                </Button>
              ) : (
                <Tag tone="gray">{t('尚未加入')}</Tag>
              )}
            </GroupRow>
          </GroupBox>
          <h3 className="feishu-section">{t('选择飞书群')}</h3>
          <GroupBox>
            <GroupRow label={t('飞书群')} description={chatListNote(data.mainAppName)}>
              <Button disabled={busy} onClick={reload}>
                {t('刷新')}
              </Button>
              <PopUpButton
                aria-label={t('飞书群')}
                placeholder={data.chats.length ? t('选择飞书群') : t('没有可关联的飞书群，先把机器人拉进群')}
                disabled={!data.chats.length}
                value={chatId}
                options={data.chats.map((c) => ({ value: c.chatId, label: c.name }))}
                onChange={setChatId}
              />
              <Button variant="primary" disabled={!chatId || busy} onClick={() => void bind()}>
                {t('关联')}
              </Button>
            </GroupRow>
          </GroupBox>
          <h3 className="feishu-section">{t('没有现成的飞书群')}</h3>
          <GroupBox>
            <GroupRow
              label={t('新建飞书群')}
              description={t('用本群名称新建飞书群并关联，拉入已绑定飞书的成员和 Bot')}
            >
              <Button disabled={busy} onClick={() => setCreating(true)}>
                {t('创建飞书群')}
              </Button>
            </GroupRow>
          </GroupBox>
        </>
      )}
      {data.chat && data.bots.length ? (
        <>
          <h3 className="feishu-section">{t('群里的 Bot')}</h3>
          <GroupBox>
            {data.bots.map((b) => {
              const own = b.appId ? null : manages(b.botId)
              return (
                <GroupRow
                  key={b.botId}
                  label={b.name}
                  description={
                    !b.appId ? (
                      t('还没有接入飞书应用，飞书群里 @ 不到它')
                    ) : b.inChat ? undefined : b.issue ? (
                      <>
                        {t('没能拉入飞书群：{reason}', { reason: feishuHintText(b.issue.code) })}
                        <span className="feishu-issue__code" title={b.issue.message}>
                          {t('飞书错误码 {code}', { code: b.issue.code })}
                        </span>
                      </>
                    ) : (
                      t(
                        '未在飞书群，回复不会同步到飞书。拉不进时，请检查飞书群是否允许添加机器人、该 Bot 的飞书应用是否已发布',
                      )
                    )
                  }
                >
                  {!b.appId ? (
                    own ? (
                      <Button onClick={() => setConnecting(own)}>{t('去接入')}</Button>
                    ) : (
                      <Tag tone="gray">{t('请 Bot 主人接入')}</Tag>
                    )
                  ) : b.inChat ? (
                    <Tag tone="green">{t('已在群中')}</Tag>
                  ) : (
                    <Button disabled={busy} onClick={() => void pullBot(b.botId)}>
                      {b.issue ? t('重试') : t('拉入飞书群')}
                    </Button>
                  )}
                </GroupRow>
              )
            })}
          </GroupBox>
        </>
      ) : null}
      <Presence>
        {connecting && me ? (
          <BotDialog
            bot={connecting}
            me={me}
            tab="feishu"
            onClose={() => {
              setConnecting(null)
              reload()
            }}
          />
        ) : null}
      </Presence>
      {creating && !data.chat ? (
        <ConfirmActionDialog
          title={t('创建飞书群')}
          message={t('确定新建飞书群「{name}」并关联到本群？', { name: group.name })}
          consequences={createConsequences(data)}
          label={t('创建')}
          done={t('已创建并关联飞书群')}
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
          title={t('取消关联飞书群')}
          message={t('确定取消关联飞书群 {name}？', { name: data.chat.name })}
          consequences={[t('飞书群里 @Bot 将不再触发运行'), t('已同步的消息保留')]}
          label={t('取消关联')}
          done={t('已取消关联飞书群')}
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
