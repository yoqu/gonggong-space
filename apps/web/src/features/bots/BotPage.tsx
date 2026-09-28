import {
  agentConfigLabel,
  type BotDto,
  type BotPlaceDto,
  type UsageDayDto,
  type UsageRowDto,
  type UserBriefDto,
  type UserDto,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { Alert, Button, ChatHeader, Tag, toast } from '../../ui'
import { RUN_STATUS } from '../chat/TimelineItems'
import { TIER_LABEL } from '../runs/tier'
import { fmtTokens, Trend, TZ, UsageBars, useGet, WINDOW } from '../usage/UsagePage'
import { APPROVAL_LABEL } from './ApprovalFields'
import { BotAvatar, ROLES } from './avatars'
import { TRIGGER_SCOPE_LABEL, warning } from './BotsAdminPage'
import { agentLine, botsApi, PRESENCE } from './model'
import './bots.css'

function ago(iso: string) {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  return min < 1440 ? `${Math.floor(min / 60)} 小时前` : `${Math.floor(min / 1440)} 天前`
}

/** Groups the bot is in; refetched whenever one of its runs changes. */
function usePlaces(botId: string, enabled: boolean) {
  const [places, setPlaces] = useState<BotPlaceDto[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    const load = () =>
      api
        .get<BotPlaceDto[]>(`/bots/${botId}/activity`)
        .then(setPlaces)
        .catch(() => setPlaces([]))
    load()
    return realtime.subscribe((e) => {
      if (e.t === 'run.updated' && e.run.botId === botId) load()
    })
  }, [botId, enabled])
  return places
}

function idleText(bot: BotDto) {
  if (bot.presence === 'online') return '空闲，在群里 @ 它即可开工'
  if (bot.presence === 'offline') return `${bot.machineName ?? '机器'} 离线，被 @ 的请求会等待机器上线`
  return PRESENCE[bot.presence].label
}

function Card({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="usage-card">
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
    <ul className="bot-page__list" aria-label="正在工作">
      {live.map((p) => {
        const run = p.run as NonNullable<BotPlaceDto['run']>
        return (
          <li key={p.groupId} className="bot-page__live">
            <div className="bot-page__line">
              <Link to={`/g/${p.groupId}`} className="bot-page__group">
                {p.groupName}
              </Link>
              <Tag tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Tag>
              {run.startedAt ? <span className="bot-page__muted">{ago(run.startedAt)}开始</span> : null}
            </div>
            {run.step ? <span className="bot-page__step">{run.step}</span> : null}
            {p.workspacePath ? <span className="bot-page__path">{p.workspacePath}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

function Places({ places }: { places: BotPlaceDto[] }) {
  if (!places.length) return <p className="bot-page__idle">还没有加入任何群，把它拉进群后即可 @ 它</p>
  return (
    <ul className="bot-page__list" aria-label="工作位置">
      {places.map((p) => (
        <li key={p.groupId}>
          <Link to={`/g/${p.groupId}`} className="bot-page__place">
            <span className="bot-page__line">
              <span className="bot-page__group">{p.groupName}</span>
              {p.groupKind === 'dm' ? <Tag tone="gray">私聊</Tag> : null}
              <span className="spacer" />
              <span className="bot-page__muted">{p.lastRunAt ? ago(p.lastRunAt) : '尚未运行'}</span>
            </span>
            <span className={p.workspacePath ? 'bot-page__path' : 'bot-page__muted'}>
              {p.workspacePath ?? '工作区未就绪'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Usage({ botId, groupCount }: { botId: string; groupCount: number }) {
  const q = `days=${WINDOW}&botId=${botId}`
  const byUser = useGet<UsageRowDto[]>(`/usage?by=user&${q}`).data
  const byGroup = useGet<UsageRowDto[]>(`/usage?by=group&${q}`).data
  const daily = useGet<UsageDayDto[]>(`/usage/daily?${q}&tz=${encodeURIComponent(TZ)}`).data
  const sum = (k: 'runs' | 'totalTokens' | 'unreported') => (byUser ?? []).reduce((n, r) => n + r[k], 0)
  const tiles = [
    { label: 'token 合计', value: byUser ? fmtTokens(sum('totalTokens')) : '--' },
    { label: '运行轮次', value: byUser ? String(sum('runs')) : '--' },
    { label: '未上报轮次', value: byUser ? String(sum('unreported')) : '--' },
    { label: '所在群', value: String(groupCount) },
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
      {byUser?.length ? (
        <div className="bot-page__pair">
          <Card title="谁用了">
            <UsageBars rows={byUser} />
          </Card>
          <Card title="按群">
            <UsageBars rows={byGroup ?? []} />
          </Card>
        </div>
      ) : null}
    </>
  )
}

function Config({ bot }: { bot: BotDto }) {
  const rows: [string, ReactNode][] = [
    ['权限档位', TIER_LABEL[bot.tier]],
    ['触发范围', TRIGGER_SCOPE_LABEL[bot.triggerScope]],
    ['模型', agentConfigLabel(bot.catalog, bot.model, bot.effort)],
    ['并发上限', `${bot.concurrency} 个群并行`],
    ['命令审批', APPROVAL_LABEL[bot.approval]],
    [
      '默认工作区',
      bot.defaultWorkspace ? (
        <span key="path" className="bot-page__path">
          {bot.defaultWorkspace}
        </span>
      ) : (
        '未设置'
      ),
    ],
  ]
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

/** A bot opened from the sidebar: what it is, whether and where it works, and what it used; settings open a dialog. */
export function BotPage({
  bot,
  me,
  onSettings,
  onBack,
}: {
  bot: BotDto
  me: UserDto
  onSettings: () => void
  onBack?: () => void
}) {
  const owner = me.id === bot.ownerId
  const canView = owner || me.role === 'sysadmin'
  const places = usePlaces(bot.id, canView)
  const users = useGet<UserBriefDto[]>('/users').data ?? []
  const warn = warning(bot, (id) => users.find((u) => u.id === id)?.name ?? '--')
  const role = ROLES[bot.avatar]
  const presence = PRESENCE[bot.presence]
  const confirm = () =>
    botsApi
      .confirm(bot.id)
      .then((b) => toast({ type: 'success', message: `${b.name} 已确认` }))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  return (
    <section className="bot-page" aria-label="Bot 概况">
      <ChatHeader
        avatar={<BotAvatar id={bot.id} name={bot.name} size={32} />}
        title={bot.name}
        subtitle={[agentLine(bot), bot.machineName, bot.ownerName].filter(Boolean).join(' · ')}
        onBack={onBack}
        actions={[{ icon: 'gear', label: '设置', onClick: onSettings }]}
      />
      <div className="bot-page__body">
        <div className="bot-page__hero">
          <BotAvatar id={bot.id} name={bot.name} size={72} />
          <div className="bot-page__intro">
            <div className="bot-page__line">
              <span className="bot-page__role">
                {role.name} · {role.title}
              </span>
              <span className="bot-page__presence">
                <span className="bot-page__dot" style={{ background: presence.color }} />
                {presence.label}
              </span>
            </div>
            <p className="bot-page__prompt">{bot.systemPrompt || role.trait}</p>
          </div>
        </div>

        {warn ? (
          <Alert variant="warning" title={warn.title} description={warn.desc}>
            {bot.presence === 'pending_confirm' && owner ? (
              <div className="bots-detail__confirm">
                <Button variant="primary" onClick={() => void confirm()}>
                  确认
                </Button>
              </div>
            ) : null}
          </Alert>
        ) : null}

        {canView ? (
          <>
            <Card title="正在工作">
              <Live bot={bot} places={places} />
            </Card>
            {places ? (
              <Card title="工作位置" meta={`${places.length} 个群`}>
                <Places places={places} />
              </Card>
            ) : null}
            <h2 className="bot-page__heading">近 {WINDOW} 天用量</h2>
            <Usage botId={bot.id} groupCount={bot.groupCount} />
          </>
        ) : null}

        <Card title="配置">
          <Config bot={bot} />
        </Card>
      </div>
    </section>
  )
}
