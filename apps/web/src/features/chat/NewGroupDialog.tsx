import type { BotDto, BotProbeDto, GroupDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Button, Dialog, GroupBox, Icon, IconButton, Input } from '../../ui'
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
import { repoName } from './repo'
import './chat.css'
import { t } from '../../i18n'

export type GroupKind = GroupDto['kind']

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

export function NewGroupDialog({ me, kind, onClose }: { me: UserDto; kind: GroupKind; onClose: () => void }) {
  const allBots = useWorkspace((s) => s.bots)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [botIds, setBotIds] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [repo, setRepo] = useState<RepoDraft>(() => emptyRepo())
  const [creating, setCreating] = useState(false)
  const dm = kind === 'dm'
  const users = useGet<UserBriefDto[]>(dm ? null : '/users').data ?? []

  const setRepoDraft = (o: Partial<RepoDraft>) => {
    setRepo((r) => ({ ...r, ...o }))
    if (o.url !== undefined && !nameTouched) setName(o.url ? repoName(o.url) : '')
  }

  const choices = allBots.filter((b) => !dm || b.ownerId === me.id)
  const picked = botIds.map((id) => allBots.find((b) => b.id === id)).filter((b): b is BotDto => !!b)
  const owners = [...new Set(picked.filter((b) => b.ownerId !== me.id).map((b) => b.ownerId))]
  const manual = people.filter((id) => !owners.includes(id))
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
    setCreating(true)
    try {
      const group = await api.post<GroupDto>('/groups', {
        name: dm ? (picked[0]?.name ?? '') : name.trim(),
        kind,
        memberIds: dm ? [] : manual,
        botIds,
        repo: bound ? repoBody(repo) : null,
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
      title={dm ? t('新建私聊') : t('新建群')}
      onClose={onClose}
      footer={
        <>
          <span className="ng-foot">{status}</span>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" disabled={disabled || checking} onClick={() => void submit()}>
            {checking ? t('检查中…') : t('创建')}
          </Button>
        </>
      }
    >
      <div className="ng">
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
                  onChange={(e) => {
                    setNameTouched(true)
                    setName(e.target.value)
                  }}
                />
              </div>
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
              bots={choices}
              isOn={(id) => botIds.includes(id)}
              onPick={(b) => setBotIds(toggle(botIds, b.id))}
            />
          </GroupBox>
        </section>

        {dm ? null : (
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
                  onAdd={(id) => setPeople([...people, id])}
                />
              </fieldset>
            </GroupBox>
          </section>
        )}

        <section className="ng-section">
          <GroupBox>
            <RepoPicker draft={repo} set={setRepoDraft} botIds={botIds} clearable />
          </GroupBox>
        </section>
      </div>
    </Dialog>
  )
}
