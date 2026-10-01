import type { TeamDto, TeamInviteDto, TeamMemberDto, TeamRole } from '@gonggong/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { copyWithToast } from '../../lib/clipboard'
import { cx } from '../../lib/cx'
import { attempt, toastError } from '../../lib/errors'
import { realtime } from '../../lib/realtime'
import { dateLocale } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Avatar,
  Button,
  ConfirmActionDialog,
  Dialog,
  GroupBox,
  GroupRow,
  Icon,
  type IconName,
  Presence,
  PullDownButton,
  SegmentedControl,
  Spinner,
  Tag,
  TextField,
} from '../../ui'
import { inviteLink, ROLE_LABEL, teamsApi } from './store'
import { TeamAuditTab, TeamGroupsTab, TeamMcpTab, TeamParamsTab, TeamUsageTab } from './TeamAdminTabs'
import '../groups/groups.css'
import './teams.css'

type Tab = 'overview' | 'members' | 'invites' | 'mcp' | 'params' | 'groups' | 'usage' | 'audit'

/** 团队设置 (plan §5): everyone reads the overview and members; admins edit, owners archive and transfer. */
export function TeamSettingsDialog({ team, onClose }: { team: TeamDto; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const admin = team.role !== 'member'
  const tabs: { value: Tab; label: string; icon: IconName; body: ReactNode }[] = [
    {
      value: 'overview',
      label: t('概览'),
      icon: 'info',
      body: <OverviewTab team={team} onClose={onClose} />,
    },
    { value: 'members', label: t('成员'), icon: 'person-2', body: <MembersTab team={team} /> },
    ...(admin
      ? ([
          { value: 'invites', label: t('邀请'), icon: 'link', body: <InvitesTab team={team} /> },
          {
            value: 'groups',
            label: t('群'),
            icon: 'hashtag',
            body: <TeamGroupsTab team={team} onClose={onClose} />,
          },
          { value: 'mcp', label: 'MCP', icon: 'plug', body: <TeamMcpTab team={team} /> },
          {
            value: 'params',
            label: t('参数#settings'),
            icon: 'slider-horizontal',
            body: <TeamParamsTab team={team} />,
          },
          { value: 'usage', label: t('用量'), icon: 'chart-bar', body: <TeamUsageTab team={team} /> },
          { value: 'audit', label: t('审计'), icon: 'doc-text', body: <TeamAuditTab team={team} /> },
        ] as const)
      : []),
  ]
  const current = tabs.find((x) => x.value === tab) ?? tabs[0]
  return (
    <Dialog open width={820} title={`${current?.label} · ${team.name}`} onClose={onClose}>
      <div className="gs-settings">
        <nav className="gs-settings__nav">
          <span className="gs-settings__heading">{t('团队设置')}</span>
          {tabs.map((x) => (
            <button
              key={x.value}
              type="button"
              className={cx('gs-settings__tab', x.value === tab && 'gs-settings__tab--on')}
              aria-current={x.value === tab ? 'page' : undefined}
              onClick={() => setTab(x.value)}
            >
              <Icon name={x.icon} size={15} />
              {x.label}
            </button>
          ))}
        </nav>
        <div className="gs-settings__body">{current?.body}</div>
      </div>
    </Dialog>
  )
}

function OverviewTab({ team, onClose }: { team: TeamDto; onClose: () => void }) {
  const admin = team.role !== 'member'
  const [name, setName] = useState(team.name)
  const [avatar, setAvatar] = useState(team.avatar ?? '')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'leave' | 'archive' | null>(null)
  const me = useSession((s) => s.user)
  const dirty = name.trim() !== team.name || (avatar.trim() || null) !== team.avatar
  const save = async () => {
    setBusy(true)
    await attempt(() => teamsApi.update(team.id, { name: name.trim(), avatar: avatar.trim() || null }))
    setBusy(false)
  }
  return (
    <>
      <GroupBox>
        <GroupRow label={t('团队名称')}>
          {admin ? (
            <TextField
              aria-label={t('团队名称')}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          ) : (
            <span className="gs-value">{team.name}</span>
          )}
        </GroupRow>
        <GroupRow label={t('头像')} description={t('一个字或表情，留空用团队名首字')}>
          {admin ? (
            <TextField
              aria-label={t('头像')}
              value={avatar}
              maxLength={8}
              onChange={(e) => setAvatar(e.target.value)}
            />
          ) : (
            <TeamAvatar team={team} size={28} />
          )}
        </GroupRow>
        <GroupRow label={t('我的角色')} value={ROLE_LABEL[team.role]} />
      </GroupBox>
      {admin ? (
        <div className="team-actions">
          <Button variant="primary" disabled={busy || !dirty || !name.trim()} onClick={() => void save()}>
            {t('保存')}
          </Button>
        </div>
      ) : null}
      <GroupBox>
        <GroupRow label={t('退出团队')} destructive onClick={() => setConfirm('leave')} />
      </GroupBox>
      {team.role === 'owner' ? (
        <GroupBox>
          <GroupRow label={t('归档团队')} destructive onClick={() => setConfirm('archive')} />
        </GroupBox>
      ) : null}
      <Presence>
        {confirm === 'leave' && me ? (
          <ConfirmActionDialog
            title={t('退出团队「{name}」？', { name: team.name })}
            message={t('退出后无法再看到该团队的群和 Bot，需重新受邀才能加入。')}
            consequences={[t('你在该团队的 Bot 将被删除并移出所有群'), t('你将退出该团队的所有群')]}
            label={t('退出团队')}
            done={t('已退出团队')}
            run={() => teamsApi.remove(team.id, me.id)}
            onDone={onClose}
            onClose={() => setConfirm(null)}
          />
        ) : confirm === 'archive' ? (
          <ConfirmActionDialog
            title={t('归档团队「{name}」？', { name: team.name })}
            message={t('归档后所有成员都无法再进入该团队。')}
            consequences={[t('该团队的群转为只读，运行中的轮次将停止'), t('成员的团队列表中不再显示该团队')]}
            label={t('归档团队')}
            done={t('团队已归档')}
            run={() => teamsApi.archive(team.id)}
            onDone={onClose}
            onClose={() => setConfirm(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}

export function TeamAvatar({ team, size }: { team: Pick<TeamDto, 'name' | 'avatar'>; size: number }) {
  return <Avatar name={team.avatar || team.name} shape="square" size={size} />
}

/** Live member list: reloads on the team's member events. */
function useMembers(teamId: string) {
  const q = useGet<TeamMemberDto[]>(`/teams/${teamId}/members`)
  const { reload } = q
  useEffect(
    () =>
      realtime.subscribe((e) => {
        if ((e.t === 'team.member_updated' || e.t === 'team.member_removed') && e.teamId === teamId) reload()
      }),
    [teamId, reload],
  )
  return q
}

function MembersTab({ team }: { team: TeamDto }) {
  const me = useSession((s) => s.user)
  const { data, error, reload } = useMembers(team.id)
  const [account, setAccount] = useState('')
  const [removing, setRemoving] = useState<TeamMemberDto | null>(null)
  const [transferring, setTransferring] = useState<TeamMemberDto | null>(null)
  const admin = team.role !== 'member'
  const owner = team.role === 'owner'

  const add = async () => {
    if (await attempt(() => teamsApi.addMember(team.id, account.trim()))) {
      setAccount('')
      reload()
    }
  }
  const act = (m: TeamMemberDto) => async (value: string) => {
    if (value === 'remove') setRemoving(m)
    else if (value === 'transfer') setTransferring(m)
    else if (await attempt(() => teamsApi.setRole(team.id, m.userId, value as TeamRole))) reload()
  }
  // Only owners touch owners or grant ownership.
  const actions = (m: TeamMemberDto) => [
    ...(['owner', 'admin', 'member'] as const)
      .filter((r) => r !== m.role && (owner || r !== 'owner'))
      .map((r) => ({ label: t('设为{role}', { role: ROLE_LABEL[r] }), value: r })),
    ...(owner ? [{ label: t('转让所有权'), value: 'transfer' }] : []),
    { separator: true as const },
    { label: t('移出团队'), value: 'remove', destructive: true },
  ]

  return (
    <>
      {admin ? (
        <form
          className="gs-toolbar"
          onSubmit={(e) => {
            e.preventDefault()
            if (account.trim()) void add()
          }}
        >
          <TextField
            aria-label={t('账号')}
            placeholder={t('输入账号添加成员')}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
          <Button type="submit" size="small" disabled={!account.trim()}>
            {t('添加成员')}
          </Button>
        </form>
      ) : null}
      {data ? (
        <GroupBox>
          {data.map((m) => (
            <div key={m.userId} className="gs-member" data-testid={`team-member-${m.userId}`}>
              <Avatar name={m.name} size={28} />
              <div className="gs-member__main">
                <span className="gs-member__name">
                  {m.name}
                  {m.userId === me?.id ? t('（我）') : ''}
                  {m.role === 'member' ? null : <Tag tone="blue">{ROLE_LABEL[m.role]}</Tag>}
                </span>
                <span className="gs-desc">{m.account}</span>
              </div>
              {admin && m.userId !== me?.id && (owner || m.role !== 'owner') ? (
                <span className="gs-member__ops">
                  <PullDownButton
                    variant="plain"
                    size="small"
                    label={t('管理#member')}
                    align="end"
                    portal
                    items={actions(m)}
                    onSelect={(v) => void act(m)(v)}
                  />
                </span>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : error ? (
        <div className="gs-note">{error}</div>
      ) : (
        <Spinner />
      )}
      <div className="gs-foot">{t('移出成员时，其在本团队的 Bot 一并删除，并退出本团队所有群。')}</div>
      <Presence>
        {removing ? (
          <ConfirmActionDialog
            title={t('将 {name} 移出团队？', { name: removing.name })}
            message={t('移出后对方无法再看到该团队的群和 Bot。')}
            consequences={[t('其在本团队的 Bot 将被删除并移出所有群'), t('其将退出本团队的所有群')]}
            label={t('移出团队')}
            done={t('已移出团队')}
            run={() => teamsApi.remove(team.id, removing.userId)}
            onClose={() => setRemoving(null)}
          />
        ) : transferring ? (
          <ConfirmActionDialog
            title={t('将团队所有权转让给 {name}？', { name: transferring.name })}
            message={t('转让后你将成为管理员。')}
            consequences={[t('对方成为所有者，可归档团队、转让所有权')]}
            label={t('转让所有权')}
            done={t('所有权已转让')}
            run={() => teamsApi.transfer(team.id, transferring.userId)}
            onClose={() => setTransferring(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}

const EXPIRY = [1, 7, 30] as const
const USES = ['1', '10', 'unlimited'] as const

function InvitesTab({ team }: { team: TeamDto }) {
  const { data, error, reload } = useGet<TeamInviteDto[]>(`/teams/${team.id}/invites`)
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [days, setDays] = useState<(typeof EXPIRY)[number]>(7)
  const [uses, setUses] = useState<(typeof USES)[number]>('unlimited')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const made = await teamsApi.invite(team.id, {
        role,
        expiresInDays: days,
        maxUses: uses === 'unlimited' ? null : Number(uses),
      })
      setLink(inviteLink(made.token))
      reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (id: string) => {
    if (await attempt(() => teamsApi.revokeInvite(team.id, id))) reload()
  }
  const status = (i: TeamInviteDto) =>
    new Date(i.expiresAt) <= new Date()
      ? t('已过期')
      : i.maxUses !== null && i.uses >= i.maxUses
        ? t('已用完')
        : t('{until} 前有效', {
            until: new Date(i.expiresAt).toLocaleString(dateLocale, {
              dateStyle: 'short',
              timeStyle: 'short',
            }),
          })

  return (
    <>
      <GroupBox>
        <GroupRow label={t('加入后角色')}>
          <SegmentedControl
            aria-label={t('加入后角色')}
            value={role}
            onChange={setRole}
            items={[
              { value: 'member', label: ROLE_LABEL.member },
              { value: 'admin', label: ROLE_LABEL.admin },
            ]}
          />
        </GroupRow>
        <GroupRow label={t('有效期')}>
          <SegmentedControl
            aria-label={t('有效期')}
            value={String(days)}
            onChange={(v) => setDays(Number(v) as (typeof EXPIRY)[number])}
            items={EXPIRY.map((d) => ({ value: String(d), label: t('{n} 天', { n: d }) }))}
          />
        </GroupRow>
        <GroupRow label={t('可用次数')}>
          <SegmentedControl
            aria-label={t('可用次数')}
            value={uses}
            onChange={setUses}
            items={[
              { value: '1', label: t('1 次') },
              { value: '10', label: t('10 次') },
              { value: 'unlimited', label: t('不限') },
            ]}
          />
        </GroupRow>
      </GroupBox>
      <div className="team-actions">
        <Button variant="primary" disabled={busy} onClick={() => void create()}>
          {t('生成邀请链接')}
        </Button>
      </div>
      {link ? (
        <div className="team-link">
          <code className="gs-mono team-link__url">{link}</code>
          <Button size="small" onClick={() => void copyWithToast(link, t('已复制邀请链接'))}>
            {t('复制')}
          </Button>
          <span className="gs-desc">{t('链接只在生成时显示一次')}</span>
        </div>
      ) : null}
      {data?.length ? (
        <GroupBox>
          {data.map((i) => (
            <GroupRow
              key={i.id}
              label={t('{role} · 已用 {uses}', {
                role: ROLE_LABEL[i.role],
                uses: i.maxUses === null ? String(i.uses) : `${i.uses}/${i.maxUses}`,
              })}
              description={status(i)}
            >
              <Button variant="plain" size="small" onClick={() => void revoke(i.id)}>
                {t('撤销')}
              </Button>
            </GroupRow>
          ))}
        </GroupBox>
      ) : error ? (
        <div className="gs-note">{error}</div>
      ) : null}
    </>
  )
}
