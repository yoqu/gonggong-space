import type { BotDto, BotProbeDto, GroupDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Button, Dialog, GroupBox, GroupRow, Icon, IconButton, Input, Switch, Tabs } from '../../ui'
import { useAuthOptions } from '../auth/options'
import { BotAvatar } from '../bots/avatars'
import { AGENT_LABEL } from '../bots/model'
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
import { NewTerminalDialog } from '../terminal/NewTerminalDialog'
import { repoName } from './repo'
import './chat.css'
import { t } from '../../i18n'

export type GroupKind = GroupDto['kind']

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

type NewProps = {
  me: UserDto
  onClose: () => void
  /** 从飞书群创建 instead (offered once the main Feishu app is configured). */
  onFromFeishu?: () => void
}

/** The top bar's「+」: 发起会话 (a group or a DM) or 新建终端 on one of my machines. */
export function NewGroupDialog(props: NewProps) {
  const [mode, setMode] = useState<'chat' | 'terminal'>('chat')
  const tabs = (
    <Tabs
      aria-label={t('新建')}
      items={[
        { value: 'chat', label: t('发起会话') },
        { value: 'terminal', label: t('新建终端') },
      ]}
      value={mode}
      onChange={setMode}
    />
  )
  return mode === 'chat' ? (
    <NewChatDialog {...props} tabs={tabs} />
  ) : (
    <NewTerminalDialog tabs={tabs} onClose={props.onClose} />
  )
}

/** 发起会话: a DM when only one of my (or shared) Bots is picked and nobody else, otherwise a group. */
function NewChatDialog({ me, onClose, onFromFeishu, tabs }: NewProps & { tabs: ReactNode }) {
  const feishu = useAuthOptions()?.feishuLogin
  const allBots = useWorkspace((s) => s.bots)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [isPublic, setPublic] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [botIds, setBotIds] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [repo, setRepo] = useState<RepoDraft>(() => emptyRepo())
  const [creating, setCreating] = useState(false)
  const users = useGet<UserBriefDto[]>('/users').data ?? []

  const setRepoDraft = (o: Partial<RepoDraft>) => {
    setRepo((r) => ({ ...r, ...o }))
    if (o.url !== undefined && !nameTouched) setName(o.url ? repoName(o.url) : '')
  }

  const picked = botIds.map((id) => allBots.find((b) => b.id === id)).filter((b): b is BotDto => !!b)
  const owners = [...new Set(picked.filter((b) => b.ownerId !== me.id).map((b) => b.ownerId))]
  const manual = people.filter((id) => !owners.includes(id))
  const only = picked.length === 1 ? picked[0] : undefined
  // A DM is me and one Bot I may chat with privately; it can never take more members.
  const dm = !!only && (only.ownerId === me.id || only.sharedWith.includes(me.id)) && !manual.length
  const kind: GroupKind = dm ? 'dm' : 'group'
  const userName = (id: string) =>
    users.find((u) => u.id === id)?.name ?? allBots.find((b) => b.ownerId === id)?.ownerName ?? ''

  const bound = !!repo.url.trim()
  const checking = bound && repo.check === 'checking'
  // A DM is titled by its Bot: it needs one, not a name.
  const disabled = (dm ? !picked.length : !name.trim()) || creating || (bound && !repoValidated(repo))
  const results = new Map<string, BotProbeDto>(
    repo.check && repo.check !== 'checking' ? repo.check.results.map((r) => [r.botId, r]) : [],
  )
  const paused = bound ? repoUnavailable(repo) : 0
  const status = !bound
    ? ''
    : branchMissing(repo)
      ? t('分支 {branch} 不存在', { branch: repo.branch.trim() || 'main' })
      : paused
        ? t('{n} 个 Bot 进群后暂停，主人配置凭据后可重新检查', { n: paused })
        : ''

  const submit = async () => {
    if (disabled || checking) return
    setCreating(true)
    try {
      const group = await api.post<GroupDto>('/groups', {
        name: dm ? (picked[0]?.name ?? '') : name.trim(),
        kind,
        memberIds: dm ? [] : manual,
        botIds,
        repo: bound ? repoBody(repo) : null,
        ...(!dm && { visibility: isPublic ? 'public' : 'private' }),
      })
      useWorkspace.getState().applyEvent({ t: 'group.updated', group })
      onClose()
      navigate(`/g/${group.id}`)
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open
      width={520}
      closeOnBackdrop={false}
      title={t('发起会话')}
      onClose={onClose}
      footer={
        <>
          {!dm && feishu && onFromFeishu && !status ? (
            <span className="ng-foot">
              <Button variant="plain" onClick={onFromFeishu}>
                {t('从飞书群创建…')}
              </Button>
            </span>
          ) : (
            <span className="ng-foot">{status}</span>
          )}
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            variant="primary"
            disabled={disabled || checking}
            loading={creating}
            onClick={() => void submit()}
          >
            {checking ? t('检查中…') : dm ? t('开始私聊') : t('创建群')}
          </Button>
        </>
      }
    >
      <div className="ng">
        {tabs}
        {dm ? null : (
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
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
            </GroupBox>
          </section>
        )}

        <section className="ng-section">
          <h3 className="ng-section__title">Bot · {picked.length}</h3>
          <GroupBox>
            {picked.map((b) => {
              const r = results.get(b.id)
              return (
                <div key={b.id} className="ng-botrow">
                  <BotAvatar id={b.id} name={b.name} size={24} />
                  <span className="pick__main">
                    <span className="pick__name">{b.name}</span>
                    <span className="pick__sub">
                      {AGENT_LABEL[b.agentKind]} · {b.ownerName}
                    </span>
                  </span>
                  {r ? <AccessResult result={r} /> : <BotPresence bot={b} />}
                  <IconButton
                    size="small"
                    title={t('移除 {name}', { name: b.name })}
                    onClick={() => setBotIds(botIds.filter((id) => id !== b.id))}
                  >
                    {'minus' as const}
                  </IconButton>
                </div>
              )
            })}
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
          {dm ? <p className="ng-hint">{t('将创建与它的私聊，之后不能再加人')}</p> : null}
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
      </div>
    </Dialog>
  )
}
