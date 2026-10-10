import {
  agentConfigLabel,
  type BotDto,
  type BotPlaceDto,
  type FeishuAppView,
  type GroupDto,
  type UsageDayDto,
  type UsageRowDto,
  type UserBriefDto,
  type UserDto,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { fmtTokens } from '../../lib/format'
import { realtime } from '../../lib/realtime'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import { Button, ChatHeader, Tag } from '../../ui'
import { RUN_STATUS } from '../chat/TimelineItems'
import { stepText } from '../runs/mcp'
import { TIER_LABEL } from '../runs/tier'
import { Trend, TZ, UsageBars, WINDOW } from '../usage/UsagePage'
import { APPROVAL_LABEL } from './ApprovalFields'
import { BotAvatar, ROLES } from './avatars'
import { type BotTab, BotWarning } from './BotSettings'
import { agentCliVersion, agentLine, BINDING_LABEL, PRESENCE, TRIGGER_SCOPE_LABEL } from './model'
import './bots.css'
import { t } from '../../i18n'

/** Coalesces a burst of run updates into one refetch. */
const REFETCH_MS = 300

/** Groups the bot is in; refetched whenever one of its runs changes. */
function usePlaces(botId: string, enabled: boolean) {
  const [places, setPlaces] = useState<BotPlaceDto[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Only the newest request may write: an older, slower answer is stale.
    let seq = 0
    const load = () => {
      const mine = ++seq
      api.get<BotPlaceDto[]>(`/bots/${botId}/activity`).then(
        (p) => mine === seq && setPlaces(p),
        () => mine === seq && setPlaces([]),
      )
    }
    load()
    const off = realtime.subscribe((e) => {
      if (e.t !== 'run.updated' || e.run.botId !== botId) return
      clearTimeout(timer)
      timer = setTimeout(load, REFETCH_MS)
    })
    return () => {
      seq++
      clearTimeout(timer)
      off()
    }
  }, [botId, enabled])
  return places
}

/** `~` for the home dir; the daemon's managed dir (<home>/workspaces/<groupId>/…) gets a name instead of its ids. */
export function workspaceText(path: string, groupId?: string) {
  if (groupId && path.includes(`/workspaces/${groupId}/`)) return t('托管工作区')
  return path.replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, '~')
}

function WorkspacePath({ path, groupId }: { path: string; groupId?: string }) {
  return (
    <span className="bot-page__path" title={path}>
      {workspaceText(path, groupId)}
    </span>
  )
}

function idleText(bot: BotDto) {
  if (bot.presence === 'online') return t('空闲，在群里 @ 它即可开工')
  if (bot.presence === 'offline')
    return t('{machine} 离线，被 @ 的请求会等待机器上线', { machine: bot.machineName ?? t('机器') })
  return PRESENCE[bot.presence].label
}

function Card({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="usage-card" aria-label={title}>
      <div className="usage-card__head">
        <span className="usage-card__title">{title}</span>
        {meta ? <span className="usage-card__meta">{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Live({ bot, places }: { bot: BotDto; places: BotPlaceDto[] | null }) {
  const live = places?.filter((p) => p.run) ?? []
  if (!live.length) return <p className="bot-page__idle">{places ? idleText(bot) : '…'}</p>
  return (
    <ul className="bot-page__list" aria-label={t('正在工作')}>
      {live.map((p) => {
        const run = p.run as NonNullable<BotPlaceDto['run']>
        return (
          <li key={p.groupId} className="bot-page__live">
            <div className="bot-page__line">
              <Link to={`/g/${p.groupId}`} className="bot-page__group">
                {p.groupName}
              </Link>
              <Tag tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Tag>
              {run.startedAt ? (
                <span className="bot-page__muted">{t('{ago}开始', { ago: ago(run.startedAt) })}</span>
              ) : null}
            </div>
            {run.step ? <span className="bot-page__step">{stepText(run)}</span> : null}
            {p.workspacePath ? <WorkspacePath path={p.workspacePath} groupId={p.groupId} /> : null}
          </li>
        )
      })}
    </ul>
  )
}

function Places({ places }: { places: BotPlaceDto[] }) {
  if (!places.length) return <p className="bot-page__idle">{t('还没有加入任何群，把它拉进群后即可 @ 它')}</p>
  return (
    <ul className="bot-page__list" aria-label={t('工作位置')}>
      {places.map((p) => (
        <li key={p.groupId}>
          <Link to={`/g/${p.groupId}`} className="bot-page__place">
            <span className="bot-page__line">
              <span className="bot-page__group">{p.groupName}</span>
              {p.groupKind === 'dm' ? <Tag tone="gray">{t('私聊')}</Tag> : null}
              <span className="spacer" />
              <span className="bot-page__muted">{p.lastRunAt ? ago(p.lastRunAt) : t('尚未运行')}</span>
            </span>
            {p.workspacePath ? (
              <WorkspacePath path={p.workspacePath} groupId={p.groupId} />
            ) : (
              <span className="bot-page__muted">{t('工作区未就绪')}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Usage({ botId, groupCount, mine }: { botId: string; groupCount: number; mine: boolean }) {
  const q = `days=${WINDOW}&botId=${botId}`
  const byUser = useGet<UsageRowDto[]>(`/usage?by=user&${q}`).data
  const byGroup = useGet<UsageRowDto[]>(mine ? null : `/usage?by=group&${q}`).data
  const daily = useGet<UsageDayDto[]>(`/usage/daily?${q}&tz=${encodeURIComponent(TZ)}`).data
  const sum = (k: 'runs' | 'totalTokens' | 'unreported') => (byUser ?? []).reduce((n, r) => n + r[k], 0)
  const tiles = [
    { label: t('token 合计'), value: byUser ? fmtTokens(sum('totalTokens')) : '--' },
    { label: t('运行轮次'), value: byUser ? String(sum('runs')) : '--' },
    { label: t('未上报轮次'), value: byUser ? String(sum('unreported')) : '--' },
    ...(mine ? [] : [{ label: t('所在群'), value: String(groupCount) }]),
  ]
  return (
    <>
      <div className="usage-stats">
        {tiles.map((t) => (
          <div key={t.label} className="usage-stat">
            <span className="usage-stat__label">{t.label}</span>
            <span className="usage-stat__value">{t.value}</span>
          </div>
        ))}
      </div>
      {daily && sum('runs') ? <Trend daily={daily} /> : null}
      {!mine && byUser?.length ? (
        <div className="bot-page__pair">
          <Card title={t('谁用了')}>
            <UsageBars rows={byUser} />
          </Card>
          <Card title={t('按群')}>
            <UsageBars rows={byGroup ?? []} />
          </Card>
        </div>
      ) : null}
    </>
  )
}

type Row = [string, ReactNode]

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="bot-page__config">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const unset = () => <span className="bot-page__muted">{t('未设置')}</span>

/**
 * Everything the editor holds, in its tabs' order. The owner's directory, Feishu app and share list stay with
 * those who can edit the bot.
 */
function Profile({
  bot,
  users,
  canEdit,
  onSettings,
}: {
  bot: BotDto
  users: UserBriefDto[]
  canEdit: boolean
  onSettings: (tab?: BotTab) => void
}) {
  const feishu = useGet<FeishuAppView>(canEdit ? `/bots/${bot.id}/feishu` : null).data
  const role = ROLES[bot.avatar]
  const names = (ids: string[]) => ids.map((id) => users.find((u) => u.id === id)?.name ?? '--').join(t('、'))
  const sections: [string, Row[], ReactNode?][] = [
    [
      t('基本信息'),
      [
        [t('角色'), `${role.name} · ${role.mix}`],
        [
          t('系统提示词'),
          bot.systemPrompt ? (
            <p key="prompt" className="bot-page__text">
              {bot.systemPrompt}
            </p>
          ) : (
            unset()
          ),
        ],
      ],
    ],
    [
      t('运行配置'),
      [
        [t('执行机器'), bot.machineName ?? BINDING_LABEL.pending_bind],
        [
          'Agent',
          <span key="agent" className="bot-page__mono">
            {agentCliVersion(bot)}
          </span>,
        ],
        [t('模型'), agentConfigLabel(bot.catalog, bot.model, bot.effort)],
        ...(canEdit
          ? ([
              [
                t('默认工作区'),
                bot.defaultWorkspace ? <WorkspacePath key="path" path={bot.defaultWorkspace} /> : unset(),
              ],
            ] as Row[])
          : []),
      ],
    ],
    [
      t('权限'),
      [
        [t('权限档位'), TIER_LABEL[bot.tier]],
        [
          t('触发范围'),
          bot.triggerScope === 'list'
            ? `${TRIGGER_SCOPE_LABEL.list} · ${names(bot.triggerList) || '--'}`
            : TRIGGER_SCOPE_LABEL[bot.triggerScope],
        ],
        [
          t('命令审批'),
          bot.approval === 'allowlist' && bot.allowlist.length
            ? `${APPROVAL_LABEL.allowlist} · ${bot.allowlist.join(t('、'))}`
            : APPROVAL_LABEL[bot.approval],
        ],
        ...(bot.alwaysAllow.length ? ([[t('始终允许'), bot.alwaysAllow.join(t('、'))]] as Row[]) : []),
      ],
    ],
    [
      t('高级'),
      [
        [t('并发上限'), t('{n} 个群并行', { n: bot.concurrency })],
        [
          t('Git 提交身份'),
          <span key="git" className="bot-page__mono">
            {`${bot.gitName ?? bot.name} <${bot.gitEmail ?? bot.gitDefaultEmail}>`}
          </span>,
        ],
        ...(canEdit ? ([[t('飞书应用'), feishu?.app?.appId ?? (feishu ? unset() : '--')]] as Row[]) : []),
      ],
    ],
    ...(canEdit
      ? ([
          [
            t('共享'),
            [[t('共享给'), bot.sharedWith.length ? names(bot.sharedWith) : t('未共享')]],
            <Button key="share" size="small" variant="plain" onClick={() => onSettings('share')}>
              {t('管理共享')}
            </Button>,
          ],
        ] as [string, Row[], ReactNode][])
      : []),
  ]
  return (
    <>
      {sections.map(([title, rows, meta]) => (
        <Card key={title} title={title} meta={meta}>
          <Rows rows={rows} />
        </Card>
      ))}
    </>
  )
}

/** Opens the caller's DM with the bot, starting one when there is none. */
function useDm(bot: BotDto) {
  const navigate = useNavigate()
  const dm = useWorkspace((s) =>
    s.groups.find((g) => g.kind === 'dm' && g.botIds.length === 1 && g.botIds[0] === bot.id),
  )
  return async () => {
    if (dm) return navigate(`/g/${dm.id}`)
    try {
      const group = await api.post<GroupDto>('/groups', {
        name: bot.name,
        kind: 'dm',
        memberIds: [],
        botIds: [bot.id],
        repo: null,
      })
      useWorkspace.getState().applyEvent({ t: 'group.updated', group })
      navigate(`/g/${group.id}`)
    } catch (e) {
      toastError(e)
    }
  }
}

/**
 * A bot opened from the sidebar: what it is and how it is set up, whether and where it works, what it used.
 * Those it is shared with see their own usage; settings open a dialog.
 */
export function BotPage({
  bot,
  me,
  onSettings,
  onBack,
}: {
  bot: BotDto
  me: UserDto
  onSettings: (tab?: BotTab) => void
  onBack?: () => void
}) {
  const owner = me.id === bot.ownerId
  const canView = owner || me.role === 'sysadmin'
  const shared = bot.sharedWith.includes(me.id)
  const places = usePlaces(bot.id, canView)
  const users = useGet<UserBriefDto[]>('/users').data ?? []
  const openDm = useDm(bot)
  const role = ROLES[bot.avatar]
  const presence = PRESENCE[bot.presence]

  return (
    <section className="bot-page" aria-label={t('Bot 概况')}>
      <ChatHeader
        avatar={<BotAvatar id={bot.id} name={bot.name} size={32} />}
        title={bot.name}
        subtitle={[agentLine(bot), bot.machineName, bot.ownerName].filter(Boolean).join(' · ')}
        onBack={onBack}
        actions={[
          ...(owner || shared
            ? [
                {
                  icon: 'bubble' as const,
                  label: t('私聊#chat'),
                  text: t('私聊#chat'),
                  onClick: () => void openDm(),
                },
              ]
            : []),
          ...(canView
            ? [{ icon: 'gear' as const, label: t('编辑 Bot'), text: t('编辑'), onClick: () => onSettings() }]
            : []),
        ]}
      />
      <div className="bot-page__body">
        <div className="bot-page__hero">
          <BotAvatar id={bot.id} name={bot.name} size={72} />
          <div className="bot-page__intro">
            <div className="bot-page__line">
              <span className="bot-page__role">
                {role.name} · {role.mix}
              </span>
              <span className="bot-page__presence">
                <span className="bot-page__dot" style={{ background: presence.color }} />
                {presence.label}
              </span>
              {shared ? <Tag tone="blue">{t('{owner} 共享给你', { owner: bot.ownerName })}</Tag> : null}
            </div>
            <p className="bot-page__prompt">{role.line}</p>
          </div>
        </div>

        <BotWarning bot={bot} users={users} owner={owner} />

        <div className={canView || shared ? 'bot-page__columns' : 'bot-page__cards'}>
          {canView || shared ? (
            <div className="bot-page__main">
              {canView ? (
                <>
                  <Card title={t('正在工作')}>
                    <Live bot={bot} places={places} />
                  </Card>
                  {places ? (
                    <Card title={t('工作位置')} meta={t('{n} 个群', { n: places.length })}>
                      <Places places={places} />
                    </Card>
                  ) : null}
                </>
              ) : null}
              <h2 className="bot-page__heading">
                {canView ? t('近 {n} 天用量', { n: WINDOW }) : t('我的近 {n} 天用量', { n: WINDOW })}
              </h2>
              <Usage botId={bot.id} groupCount={bot.groupCount} mine={!canView} />
            </div>
          ) : null}
          <div className="bot-page__side">
            <Profile bot={bot} users={users} canEdit={canView} onSettings={onSettings} />
          </div>
        </div>
      </div>
    </section>
  )
}
