import type { BotDto, BotProbeDto, GroupDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { Button, Dialog, GroupBox, Icon, IconButton, Input, Popover, SearchField, toast } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { AGENT_LABEL, BINDING_LABEL, PRESENCE } from '../bots/model'
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

export type GroupKind = GroupDto['kind']

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

/** Presence dot and label, shown while there is no access check result for the bot. */
function Presence({ bot }: { bot: BotDto }) {
  const st =
    bot.binding === 'bound'
      ? PRESENCE[bot.presence]
      : { label: BINDING_LABEL[bot.binding], color: 'var(--system-orange)' }
  return (
    <span className="ng-presence">
      <span className="dot dot--sm" style={{ background: st.color }} />
      {st.label}
    </span>
  )
}

export function NewGroupDialog({ me, kind, onClose }: { me: UserDto; kind: GroupKind; onClose: () => void }) {
  const allBots = useWorkspace((s) => s.bots)
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserBriefDto[]>([])
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [botIds, setBotIds] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [repo, setRepo] = useState<RepoDraft>(() => emptyRepo())
  const [creating, setCreating] = useState(false)
  const dm = kind === 'dm'

  useEffect(() => {
    if (!dm) api.get<UserBriefDto[]>('/users').then(setUsers, () => {})
  }, [dm])

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
  const disabled = !name.trim() || creating || (bound && !repoValidated(repo))
  const results = new Map<string, BotProbeDto>(
    repo.check && repo.check !== 'checking' ? repo.check.results.map((r) => [r.botId, r]) : [],
  )
  const paused = bound ? repoUnavailable(repo) : 0
  const status = !bound
    ? ''
    : branchMissing(repo)
      ? `分支 ${repo.branch.trim() || 'main'} 不存在`
      : paused
        ? `${paused} 个 Bot 进群后暂停，主人配置凭据后可重新检查`
        : ''

  const submit = async () => {
    setCreating(true)
    try {
      const group = await api.post<GroupDto>('/groups', {
        name: name.trim(),
        kind,
        memberIds: dm ? [] : manual,
        botIds,
        repo: bound ? repoBody(repo) : null,
      })
      useWorkspace.getState().applyEvent({ t: 'group.updated', group })
      onClose()
      navigate(`/g/${group.id}`)
    } catch (e) {
      toast({ type: 'error', message: e instanceof ApiError ? e.message : '创建失败，请重试' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open
      width={520}
      closeOnBackdrop={false}
      title={dm ? '新建私聊' : '新建群'}
      onClose={onClose}
      footer={
        <>
          <span className="ng-foot">{status}</span>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={disabled || checking} onClick={() => void submit()}>
            {checking ? '检查中…' : '创建'}
          </Button>
        </>
      }
    >
      <div className="ng">
        <section className="ng-section">
          <h3 className="ng-section__title">名称</h3>
          <GroupBox>
            <div className="ng-name">
              <Input
                aria-label="名称"
                value={name}
                maxLength={60}
                placeholder={dm ? '如：脚本实验' : '如：退款 v2 迁移'}
                onChange={(e) => {
                  setNameTouched(true)
                  setName(e.target.value)
                }}
              />
            </div>
          </GroupBox>
        </section>

        <section className="ng-section">
          <h3 className="ng-section__title">Bot · {picked.length}</h3>
          <GroupBox>
            {picked.map((b) => {
              const r = results.get(b.id)
              return (
                <div key={b.id} className="ng-botrow">
                  <BotAvatar id={b.id} name={b.name} size={24} />
                  <span className="ng-botrow__main">
                    <span className="ng-botrow__name">{b.name}</span>
                    <span className="ng-botrow__sub">
                      {AGENT_LABEL[b.agentKind]} · {b.ownerName}
                    </span>
                  </span>
                  {r ? <AccessResult result={r} /> : <Presence bot={b} />}
                  <IconButton
                    size="small"
                    title={`移除 ${b.name}`}
                    onClick={() => setBotIds(botIds.filter((id) => id !== b.id))}
                  >
                    {'minus' as const}
                  </IconButton>
                </div>
              )
            })}
            <Popover
              width={320}
              aria-label="添加 Bot"
              className="ng-add"
              trigger={
                <button type="button" className="ng-add__trigger">
                  添加 Bot…
                </button>
              }
            >
              <fieldset className="ng-pick" aria-label="可添加的 Bot">
                {choices.map((b) => {
                  const on = botIds.includes(b.id)
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      disabled={b.binding !== 'bound'}
                      title={b.binding === 'bound' ? undefined : `${BINDING_LABEL[b.binding]}，暂不能拉入`}
                      className="ng-pick__row"
                      onClick={() => setBotIds(toggle(botIds, b.id))}
                    >
                      <span className="ng-pick__check">
                        {on ? <Icon name="check" size={12} weight={2} /> : null}
                      </span>
                      <BotAvatar id={b.id} name={b.name} size={20} />
                      <span className="ng-botrow__main">
                        <span className="ng-botrow__name">{b.name}</span>
                        <span className="ng-botrow__sub">
                          {AGENT_LABEL[b.agentKind]} · {b.ownerName}
                        </span>
                      </span>
                      <Presence bot={b} />
                    </button>
                  )
                })}
                {choices.length ? null : <span className="ng-pick__empty">还没有可拉入的 Bot</span>}
              </fieldset>
            </Popover>
          </GroupBox>
        </section>

        {dm ? null : (
          <section className="ng-section">
            <h3 className="ng-section__title">
              成员 · {1 + owners.length + manual.length}
              {owners.length ? '（Bot 主人自动加入）' : ''}
            </h3>
            <GroupBox>
              <fieldset className="ng-members" aria-label="成员">
                <span className="ng-member ng-member--fixed" title="群管理员">
                  {me.name}
                  <span className="ng-member__sub">群管理员</span>
                </span>
                {owners.map((id) => (
                  <span key={id} className="ng-member ng-member--fixed" title="Bot 主人，自动加入">
                    {userName(id)}
                    <span className="ng-member__sub">Bot 主人</span>
                  </span>
                ))}
                {manual.map((id) => (
                  <span key={id} className="ng-member">
                    {userName(id)}
                    <button
                      type="button"
                      className="ng-member__x"
                      aria-label={`移除 ${userName(id)}`}
                      onClick={() => setPeople(people.filter((p) => p !== id))}
                    >
                      <Icon name="xmark" size={9} weight={2.4} />
                    </button>
                  </span>
                ))}
                <AddMember
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
          <h3 className="ng-section__title">仓库</h3>
          <GroupBox>
            <RepoPicker draft={repo} set={setRepoDraft} botIds={botIds} clearable />
          </GroupBox>
        </section>
      </div>
    </Dialog>
  )
}

function AddMember({ users, onAdd }: { users: UserBriefDto[]; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const list = users.filter((u) => !needle || `${u.name} ${u.account}`.toLowerCase().includes(needle))
  return (
    <Popover
      width={240}
      aria-label="添加成员"
      trigger={
        <button type="button" className="ng-member ng-member--add" aria-label="添加成员">
          <Icon name="plus" size={11} weight={2} />
        </button>
      }
    >
      {(close) => (
        <div className="ng-pick">
          <SearchField aria-label="搜索成员" value={q} onChange={setQ} />
          {list.map((u) => (
            <button
              key={u.id}
              type="button"
              className="ng-pick__row"
              onClick={() => {
                onAdd(u.id)
                setQ('')
                close()
              }}
            >
              <span className="ng-botrow__main">
                <span className="ng-botrow__name">{u.name}</span>
                <span className="ng-botrow__sub">{u.account}</span>
              </span>
            </button>
          ))}
          {list.length ? null : <span className="ng-pick__empty">没有可添加的成员</span>}
        </div>
      )}
    </Popover>
  )
}
