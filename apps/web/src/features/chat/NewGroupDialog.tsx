import type { BotDto, GroupDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Button, Dialog, Icon, Input, Tabs, toast } from '../../ui'
import { AGENT_LABEL, BINDING_LABEL, PRESENCE } from '../bots/model'
import { type RepoDraft, RepoFields, repoBody, repoValidated } from './RepoFields'
import { repoName } from './repo'
import './chat.css'

export type GroupKind = GroupDto['kind']

const botState = (b: BotDto) =>
  b.binding === 'bound'
    ? PRESENCE[b.presence]
    : { label: BINDING_LABEL[b.binding], color: 'var(--system-orange)' }

interface Draft extends RepoDraft {
  kind: GroupKind
  name: string
  repoMode: 'repo' | 'none'
  people: string[]
  bots: string[]
}

const blank = (kind: GroupKind): Draft => ({
  kind,
  name: '',
  repoMode: 'repo',
  url: '',
  branch: 'main',
  check: null,
  people: [],
  bots: [],
})

export function NewGroupDialog({ me, kind, onClose }: { me: UserDto; kind: GroupKind; onClose: () => void }) {
  const bots = useWorkspace((s) => s.bots)
  const [users, setUsers] = useState<UserBriefDto[]>([])
  const navigate = useNavigate()
  const [d, setD] = useState(() => blank(kind))
  const [creating, setCreating] = useState(false)
  const set = (o: Partial<Draft>) => setD((prev) => ({ ...prev, ...o }))

  useEffect(() => {
    api.get<UserBriefDto[]>('/users').then(setUsers, () => {})
  }, [])

  const dm = d.kind === 'dm'
  const repo = d.repoMode === 'repo'
  const choices = bots.filter((b) => !dm || b.ownerId === me.id)
  const owners = new Set(
    bots.filter((b) => d.bots.includes(b.id) && b.ownerId !== me.id).map((b) => b.ownerId),
  )
  const members = new Set([...d.people, ...owners])
  const blocked = !d.name.trim() ? '填写群名' : repo && !repoValidated(d) ? '先校验仓库地址' : ''
  const name = repoName(d.url.trim())

  const submit = async () => {
    setCreating(true)
    try {
      const group = await api.post<GroupDto>('/groups', {
        name: d.name.trim(),
        kind: d.kind,
        memberIds: dm ? [] : d.people,
        botIds: d.bots,
        repo: repo ? repoBody(d) : null,
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

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <Dialog
      open
      width={540}
      closeOnBackdrop={false}
      title={dm ? '新建私聊' : '新建群'}
      subtitle={dm ? '只有你和你的 Bot' : '创建者即群管理员'}
      onClose={onClose}
      footer={
        <>
          <span className={cx('ng-foot', blocked && 'ng-foot--muted')}>
            {blocked ||
              (repo
                ? `${d.bots.length} 个 Bot 进群后绑定工作区，可托管克隆 ${name}`
                : `${d.bots.length} 个 Bot 进群后使用默认工作区或主人选择的目录`)}
          </span>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!!blocked || creating} onClick={() => void submit()}>
            创建
          </Button>
        </>
      }
    >
      <div className="ng">
        <Tabs
          size="sm"
          value={d.kind}
          onChange={(k) => set({ kind: k, people: [], bots: [] })}
          items={[
            { value: 'group', label: '群' },
            { value: 'dm', label: '私聊' },
          ]}
        />
        <div className="ng-field">
          <span className="ng-label">名称 *</span>
          <Input
            aria-label="名称"
            value={d.name}
            maxLength={60}
            placeholder="如：退款 v2 迁移"
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>

        <div className="ng-field">
          <div className="ng-row">
            <span className="ng-label">git 仓库</span>
            <span className="spacer" />
            <Tabs
              size="sm"
              value={d.repoMode}
              onChange={(repoMode) => set({ repoMode })}
              items={[
                { value: 'repo', label: '绑定仓库' },
                { value: 'none', label: '暂不绑定' },
              ]}
            />
          </div>
          {repo ? (
            <>
              <RepoFields draft={d} set={set} />
              <span className="ng-note">
                每个群绑定一个仓库。Bot 加入后由各自 daemon 用本机 git 凭据 clone
                到托管工作区；服务器不持有写权限。
              </span>
            </>
          ) : (
            <span className="ng-note">
              每个 Bot 得到一个托管的空工作区，只能用分区模式；之后绑定仓库时工作区重建。
            </span>
          )}
        </div>

        <div className="ng-mode">
          <Icon name="git-fork" size={14} className="muted-icon" />
          <div className="ng-mode__text">
            <span className="ng-mode__title">同步模式 · 分区模式</span>
            <span className="ng-note">
              {repo
                ? '新群默认分区模式。需要强制同步时，在群设置中切换（含网络检测与就绪检查）。'
                : '未绑定仓库的群只能使用分区模式。'}
            </span>
          </div>
        </div>

        {dm ? null : (
          <div className="ng-field">
            <span className="ng-label">成员 · {members.size + 1} 人</span>
            <fieldset className="ng-chips" aria-label="成员">
              <button type="button" className="ng-chip ng-chip--on ng-chip--fixed" aria-pressed="true">
                <Icon name="check" size={11} weight={2} />
                {me.name}
                <span className="ng-chip__sub">群管理员</span>
              </button>
              {users
                .filter((u) => u.id !== me.id)
                .map((u) => {
                  const auto = owners.has(u.id)
                  const on = members.has(u.id)
                  return (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={on}
                      className={cx('ng-chip', on && 'ng-chip--on', auto && 'ng-chip--fixed')}
                      onClick={() => !auto && set({ people: toggle(d.people, u.id) })}
                    >
                      {on ? <Icon name="check" size={11} weight={2} /> : null}
                      {u.name}
                      {auto ? <span className="ng-chip__sub">Bot 主人</span> : null}
                    </button>
                  )
                })}
            </fieldset>
          </div>
        )}

        <div className="ng-field">
          <span className="ng-label">拉入 Bot · {d.bots.length} 个</span>
          {choices.map((b) => {
            const on = d.bots.includes(b.id)
            const st = botState(b)
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                disabled={b.binding !== 'bound'}
                className={cx('ng-bot', on && 'ng-bot--on')}
                onClick={() => set({ bots: toggle(d.bots, b.id) })}
              >
                <span className="ng-bot__box">
                  {on ? <Icon name="check" size={10} weight={2.2} /> : null}
                </span>
                <span className="ng-bot__main">
                  <span className="ng-bot__name">{b.name}</span>
                  <span className="ng-bot__sub">
                    {AGENT_LABEL[b.agentKind]} · {b.ownerName}
                  </span>
                </span>
                <span className="ng-bot__state">
                  <span className="dot dot--sm" style={{ background: st.color }} />
                  {st.label}
                </span>
              </button>
            )
          })}
          {choices.length ? null : <span className="ng-note">还没有可拉入的 Bot</span>}
          <span className="ng-note">
            {dm
              ? '私聊只能拉入你自己的 Bot；其他人不能加入，也不能触发。可绑仓库、可选同步模式，规则与群相同。'
              : 'Bot 的主人会自动成为群成员；谁能触发由 Bot 自己的触发范围决定。'}
          </span>
        </div>
      </div>
    </Dialog>
  )
}
