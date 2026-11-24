import {
  AGENT_META,
  type BotDto,
  type BotProbeDto,
  type FeishuIdentityView,
  type GroupDto,
  type UserBriefDto,
  type UserDto,
} from '@gonggong/protocol'
import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  AgentIcon,
  Button,
  Dialog,
  GroupBox,
  GroupRow,
  Icon,
  IconButton,
  Input,
  Switch,
  Tabs,
  toast,
} from '../../ui'
import { useAuthOptions } from '../auth/options'
import { BotAvatar } from '../bots/avatars'
import { BotPicker, BotPresence, MemberPicker } from '../groups/pickers'
import { RepoPicker } from '../repos/RepoPicker'
import {
  AccessResult,
  branchMissing,
  emptyRepo,
  type RepoDraft,
  repoBody,
  repoUnavailable,
  repoValidated,
} from '../repos/repo-access'
import { useSettings } from '../settings/store'
import { TerminalFormBody, useTerminalForm } from '../terminal/NewTerminalDialog'
import { repoName } from './repo'
import './chat.css'
import { t } from '../../i18n'

export type GroupKind = GroupDto['kind']
type NewTab = 'group' | 'dm' | 'terminal'

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

type NewProps = {
  me: UserDto
  onClose: () => void
  /** 从飞书群创建 instead (offered once the main Feishu app is configured). */
  onFromFeishu?: () => void
}

function repoResults(repo: RepoDraft) {
  return new Map<string, BotProbeDto>(
    repo.check && repo.check !== 'checking' ? repo.check.results.map((r) => [r.botId, r]) : [],
  )
}

function repoMissingReason(repo: RepoDraft) {
  if (!repo.url.trim()) return ''
  if (repo.check === 'checking') return t('正在检查仓库访问权限…')
  if (branchMissing(repo)) return t('分支 {branch} 不存在', { branch: repo.branch.trim() || 'main' })
  if (!repoValidated(repo)) return t('请等待仓库访问检查完成')
  return ''
}

function BotRow({ bot, result, onRemove }: { bot: BotDto; result?: BotProbeDto; onRemove: () => void }) {
  return (
    <div className="ng-botrow">
      <BotAvatar id={bot.id} name={bot.name} size={24} />
      <span className="pick__main">
        <span className="pick__name">{bot.name}</span>
        <span className="pick__sub">
          <AgentIcon kind={bot.agentKind} size={12} /> {AGENT_META[bot.agentKind].name} · {bot.ownerName}
        </span>
      </span>
      {result ? <AccessResult result={result} /> : <BotPresence bot={bot} />}
      <IconButton size="small" title={t('移除 {name}', { name: bot.name })} onClick={onRemove}>
        {'minus' as const}
      </IconButton>
    </div>
  )
}

/** The top bar's「+」: flat 建群 | 私聊 | 新建终端 tabs, preserving drafts across switches. */
export function NewGroupDialog({ me, onClose, onFromFeishu }: NewProps) {
  const [mode, setMode] = useState<NewTab>('group')
  const feishu = useAuthOptions()?.feishuLogin
  const allBots = useWorkspace((s) => s.bots)
  const navigate = useNavigate()
  const reasonId = useId()
  const composing = useRef(false)

  // Group draft
  const [name, setName] = useState('')
  const [isPublic, setPublic] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [botIds, setBotIds] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [repo, setRepo] = useState<RepoDraft>(() => emptyRepo())
  const [withFeishu, setWithFeishu] = useState(false)

  // DM draft
  const [dmBotId, setDmBotId] = useState<string | null>(null)
  const [dmRepo, setDmRepo] = useState<RepoDraft>(() => emptyRepo())

  // Terminal draft (preserved across tab switches)
  const terminal = useTerminalForm({ onClose })

  const [creating, setCreating] = useState(false)
  const busy = creating || terminal.creating
  const usersQ = useGet<UserBriefDto[]>('/users')
  const users = usersQ.data ?? []
  // The Feishu chat is owned by its creator, so it needs their linked Feishu account.
  const feishuId = useGet<FeishuIdentityView>(feishu ? '/me/feishu' : null).data

  const setRepoDraft = (o: Partial<RepoDraft>) => {
    setRepo((r) => ({ ...r, ...o }))
    if (o.url !== undefined && !nameTouched) setName(o.url ? repoName(o.url) : '')
  }
  const setDmRepoDraft = (o: Partial<RepoDraft>) => setDmRepo((r) => ({ ...r, ...o }))

  const picked = botIds.map((id) => allBots.find((b) => b.id === id)).filter((b): b is BotDto => !!b)
  const only = picked.length === 1 ? picked[0] : undefined
  const suggestDm =
    !!only &&
    (only.ownerId === me.id || only.sharedWith.includes(me.id)) &&
    !people.length &&
    !nameTouched &&
    !isPublic &&
    !withFeishu
  const owners = [...new Set(picked.filter((b) => b.ownerId !== me.id).map((b) => b.ownerId))]
  const manual = people.filter((id) => !owners.includes(id))
  const userName = (id: string) =>
    users.find((u) => u.id === id)?.name ?? allBots.find((b) => b.ownerId === id)?.ownerName ?? ''

  const dmBots = allBots.filter((b) => b.ownerId === me.id || b.sharedWith.includes(me.id))
  const dmBot = dmBotId ? (dmBots.find((b) => b.id === dmBotId) ?? null) : null

  const groupBound = !!repo.url.trim()
  const dmBound = !!dmRepo.url.trim()
  const groupChecking = groupBound && repo.check === 'checking'
  const dmChecking = dmBound && dmRepo.check === 'checking'

  const groupMissing = !name.trim() ? t('请填写群名称') : repoMissingReason(repo)
  const dmMissing = !dmBot ? t('请选择一个 Bot') : repoMissingReason(dmRepo)
  const missingReason = mode === 'group' ? groupMissing : mode === 'dm' ? dmMissing : terminal.missingReason

  const activeRepo = mode === 'group' ? repo : mode === 'dm' ? dmRepo : null
  const activeBound = mode === 'group' ? groupBound : mode === 'dm' ? dmBound : false
  const paused = activeBound && activeRepo && !branchMissing(activeRepo) ? repoUnavailable(activeRepo) : 0
  const pausedNote = paused ? t('{n} 个 Bot 进群后暂停，主人配置凭据后可重新检查', { n: paused }) : ''

  const submitDisabled = mode === 'terminal' ? !terminal.ready : Boolean(missingReason) || busy
  const submitLabel =
    mode === 'terminal'
      ? t('创建')
      : mode === 'dm'
        ? dmChecking
          ? t('检查中…')
          : t('开始私聊')
        : groupChecking
          ? t('检查中…')
          : t('创建群')

  const submitChat = async () => {
    if (submitDisabled || mode === 'terminal') return
    const isDm = mode === 'dm'
    setCreating(true)
    try {
      const group = await api.post<GroupDto>('/groups', {
        name: isDm ? (dmBot?.name ?? '') : name.trim(),
        kind: isDm ? 'dm' : 'group',
        memberIds: isDm ? [] : manual,
        botIds: isDm ? (dmBot ? [dmBot.id] : []) : botIds,
        repo: isDm ? (dmBound ? repoBody(dmRepo) : null) : groupBound ? repoBody(repo) : null,
        ...(!isDm && { visibility: isPublic ? 'public' : 'private' }),
      })
      useWorkspace.getState().applyEvent({ t: 'group.updated', group })
      if (!isDm && withFeishu)
        await api.post(`/groups/${group.id}/feishu/chat`, {}).catch((e) =>
          toast({
            type: 'error',
            message: t('群已创建，但没能创建飞书群：{reason}。可在群设置 › 飞书重试', {
              reason: errorText(e),
            }),
          }),
        )
      onClose()
      navigate(`/g/${group.id}`)
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }

  const onSubmit = () => (mode === 'terminal' ? terminal.submit() : submitChat())
  const results = repoResults(repo)
  const dmResults = repoResults(dmRepo)

  const tabs = (
    <Tabs
      aria-label={t('新建')}
      items={[
        { value: 'group' as const, label: t('建群'), disabled: busy },
        { value: 'dm' as const, label: t('私聊#new'), disabled: busy },
        { value: 'terminal' as const, label: t('新建终端'), disabled: busy },
      ]}
      value={mode}
      onChange={(next) => {
        if (!busy) setMode(next)
      }}
    />
  )

  return (
    <Dialog
      open
      width={520}
      closeOnBackdrop={false}
      title={mode === 'terminal' ? t('新建终端') : t('发起会话')}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <div className="ng-foot">
            {mode === 'group' && feishu && onFromFeishu ? (
              <Button variant="plain" size="small" disabled={busy} onClick={onFromFeishu}>
                {t('从飞书群创建…')}
              </Button>
            ) : null}
            <span id={reasonId} className="ng-foot__msg" aria-live="polite">
              {missingReason}
            </span>
            {pausedNote ? <span className="ng-foot__warn">{pausedNote}</span> : null}
          </div>
          <Button disabled={busy} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            variant="primary"
            disabled={submitDisabled}
            loading={busy}
            aria-describedby={missingReason ? reasonId : undefined}
            onClick={() => void onSubmit()}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className={mode === 'terminal' ? 'nt-form' : 'ng'}>
        {tabs}
        {mode === 'group' ? (
          <>
            <section className="ng-section">
              <h3 className="ng-section__title">{t('名称')}</h3>
              <GroupBox>
                <div className="ng-name">
                  <Input
                    aria-label={t('名称')}
                    value={name}
                    maxLength={60}
                    placeholder={t('如：退款 v2 迁移')}
                    autoFocus
                    enterKeyHint="done"
                    onCompositionStart={() => {
                      composing.current = true
                    }}
                    onCompositionEnd={() => {
                      setTimeout(() => {
                        composing.current = false
                      })
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' &&
                        !composing.current &&
                        !e.nativeEvent.isComposing &&
                        e.keyCode !== 229
                      )
                        void submitChat()
                    }}
                    onChange={(e) => {
                      setNameTouched(true)
                      setName(e.target.value)
                    }}
                  />
                </div>
                <GroupRow label={t('公开频道')} description={t('团队成员可在「浏览频道」中找到并自行加入')}>
                  <Switch aria-label={t('公开频道')} checked={isPublic} onChange={setPublic} />
                </GroupRow>
                {feishu && feishuId ? (
                  <GroupRow
                    label={t('同时创建飞书群')}
                    description={
                      feishuId.identity ? (
                        t('用群名称新建飞书群并关联，拉入已绑定飞书的成员和 Bot')
                      ) : (
                        <>
                          {t('先在设置 › 账户中绑定飞书账号')}{' '}
                          <button
                            type="button"
                            className="ng-link"
                            onClick={() => {
                              onClose()
                              useSettings.getState().open('account')
                            }}
                          >
                            {t('去绑定 ›')}
                          </button>
                        </>
                      )
                    }
                  >
                    <Switch
                      aria-label={t('同时创建飞书群')}
                      checked={withFeishu}
                      disabled={!feishuId.identity}
                      onChange={setWithFeishu}
                    />
                  </GroupRow>
                ) : null}
              </GroupBox>
            </section>

            <section className="ng-section">
              <h3 className="ng-section__title">Bot · {picked.length}</h3>
              <GroupBox>
                {picked.map((b) => (
                  <BotRow
                    key={b.id}
                    bot={b}
                    result={results.get(b.id)}
                    onRemove={() => setBotIds(botIds.filter((id) => id !== b.id))}
                  />
                ))}
                <BotPicker
                  className="ng-add"
                  trigger={
                    <button type="button" className="ng-add__trigger">
                      {t('添加 Bot…')}
                    </button>
                  }
                  bots={allBots}
                  isOn={(id) => botIds.includes(id)}
                  onPick={(b) => setBotIds(toggle(botIds, b.id))}
                />
              </GroupBox>
              {suggestDm && only ? (
                <p className="ng-hint ng-hint--row">
                  <span>{t('只有你和 {name}，也可以直接发起私聊', { name: only.name })}</span>
                  <button
                    type="button"
                    className="ng-link"
                    onClick={() => {
                      setDmBotId(only.id)
                      if (!dmRepo.url.trim() && repo.url.trim()) setDmRepo(repo)
                      setMode('dm')
                    }}
                  >
                    {t('切到私聊')}
                  </button>
                </p>
              ) : null}
            </section>

            <section className="ng-section">
              <h3 className="ng-section__title">
                {t('成员 · {n}', { n: 1 + owners.length + manual.length })}
                {owners.length ? t('（Bot 主人自动加入）') : ''}
              </h3>
              <GroupBox>
                <fieldset className="ng-members" aria-label={t('成员')}>
                  <span className="ng-member ng-member--fixed" title={t('群管理员')}>
                    {me.name}
                    <span className="ng-member__sub">{t('群管理员')}</span>
                  </span>
                  {owners.map((id) => (
                    <span key={id} className="ng-member ng-member--fixed" title={t('Bot 主人，自动加入')}>
                      {userName(id)}
                      <span className="ng-member__sub">{t('Bot 主人')}</span>
                    </span>
                  ))}
                  {manual.map((id) => (
                    <span key={id} className="ng-member">
                      {userName(id)}
                      <button
                        type="button"
                        className="ng-member__x"
                        aria-label={t('移除 {name}', { name: userName(id) })}
                        onClick={() => setPeople(people.filter((p) => p !== id))}
                      >
                        <Icon name="xmark" size={9} weight={2.4} />
                      </button>
                    </span>
                  ))}
                  <MemberPicker
                    trigger={
                      <button type="button" className="ng-member ng-member--add" aria-label={t('添加成员')}>
                        <Icon name="plus" size={11} weight={2} />
                      </button>
                    }
                    users={users.filter(
                      (u) => u.id !== me.id && !owners.includes(u.id) && !manual.includes(u.id),
                    )}
                    loading={!usersQ.data && !usersQ.error}
                    status={
                      usersQ.error ? (
                        <span className="ng-error">
                          {t('成员列表加载失败')}
                          <Button size="small" loading={usersQ.loading} onClick={usersQ.reload}>
                            {t('重试')}
                          </Button>
                        </span>
                      ) : undefined
                    }
                    onAdd={(ids) => setPeople([...people, ...ids])}
                  />
                </fieldset>
              </GroupBox>
            </section>

            <section className="ng-section">
              <GroupBox>
                <RepoPicker draft={repo} set={setRepoDraft} botIds={botIds} clearable />
              </GroupBox>
            </section>
          </>
        ) : mode === 'dm' ? (
          <>
            <section className="ng-section">
              <h3 className="ng-section__title">Bot · {dmBot ? 1 : 0}</h3>
              <GroupBox>
                {dmBot ? (
                  <BotRow bot={dmBot} result={dmResults.get(dmBot.id)} onRemove={() => setDmBotId(null)} />
                ) : null}
                <BotPicker
                  className="ng-add"
                  trigger={
                    <button type="button" className="ng-add__trigger">
                      {dmBot ? t('更换 Bot…') : t('选择 Bot…')}
                    </button>
                  }
                  bots={dmBots}
                  isOn={(id) => dmBotId === id}
                  onPick={(b, close) => {
                    setDmBotId(b.id)
                    close()
                  }}
                />
              </GroupBox>
              {!dmBots.length ? (
                <p className="ng-hint">{t('还没有可用于私聊的 Bot，先新建或请同事共享一个 Bot')}</p>
              ) : null}
            </section>

            <section className="ng-section">
              <GroupBox>
                <RepoPicker draft={dmRepo} set={setDmRepoDraft} botIds={dmBot ? [dmBot.id] : []} clearable />
              </GroupBox>
            </section>
          </>
        ) : (
          <TerminalFormBody form={terminal} />
        )}
      </div>
    </Dialog>
  )
}
