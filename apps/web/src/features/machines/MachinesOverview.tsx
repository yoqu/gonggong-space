import {
  AGENT_KINDS,
  AGENT_META,
  agentMeta,
  type BotDto,
  type MachineDto,
  type ProviderStoreView,
} from '@gonggong/protocol'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { t } from '../../i18n'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import { AgentIcon, Button, EmptyState, Icon, PickChatArt, Tag } from '../../ui'
import { choiceLabel, machineDefault, needsOfficialLogin } from '../agents/model'
import { agentsUndetected, reportedAgent } from '../bots/model'
import { OS_ICON } from './MachineDetails'
import { OS_LABEL } from './model'
import '../works/works.css'
import './machines.css'

/** /machines with nothing picked: a card per machine, or how to bind the first one. */
export function MachinesOverview({
  machines,
  bots,
  onBindMachine,
  onNewBot,
}: {
  machines: MachineDto[]
  bots: BotDto[]
  onBindMachine: () => void
  onNewBot: (machineId: string) => void
}) {
  return (
    <section className="machines-overview" aria-label={t('电脑总览')}>
      {/* The same page head as 市场 and 作品. */}
      <header className="works__head">
        <h1 className="works__title">{t('我的电脑')}</h1>
        {machines.length ? <span className="works__count">{machines.length}</span> : null}
      </header>
      {machines.length ? (
        <div className="machines-overview__grid">
          {machines.map((m, i) => (
            <MachineCard
              key={m.id}
              index={i}
              machine={m}
              bots={bots.filter((b) => b.machineId === m.id)}
              onNewBot={onNewBot}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          illustration={<PickChatArt />}
          title={t('还没有绑定电脑')}
          description={t(
            '在一台装有 Claude Code、Codex 或 Gemini CLI 的电脑上安装共工空间客户端并绑定，Bot 就在上面运行。',
          )}
          action={
            <Button variant="primary" icon="plus" onClick={onBindMachine}>
              {t('绑定新电脑')}
            </Button>
          }
        />
      )}
    </section>
  )
}

function MachineCard({
  machine: m,
  bots,
  index,
  onNewBot,
}: {
  machine: MachineDto
  bots: BotDto[]
  index: number
  onNewBot: (machineId: string) => void
}) {
  // Providers live on the machine alone: read live while it is online, never kept.
  const view = useGet<ProviderStoreView>(
    m.online && m.features.includes('providers') ? `/machines/${m.id}/providers` : null,
  ).data
  const running = bots.filter((b) => b.presence === 'running').length
  return (
    <div className="machine-card" data-online={m.online} style={{ '--i': index } as CSSProperties}>
      <Link to={`/machine/${m.id}`} className="machine-card__open">
        <span className="machine-card__head">
          <Icon name={OS_ICON[m.os]} size={18} />
          <span className="machine-card__name">{m.name}</span>
          <span className="machine__status" data-online={m.online}>
            {m.online ? t('在线') : t('离线')}
          </span>
        </span>
        <span className="mx-sub">{[OS_LABEL[m.os], m.arch].join(' · ')}</span>
        {!m.online && m.lastSeenAt ? (
          <span className="mx-sub">{t('最后在线：{time}', { time: ago(m.lastSeenAt) })}</span>
        ) : null}
        <span className="machine-card__agents">
          {AGENT_KINDS.filter((kind) => !agentMeta(kind).feature || reportedAgent(m, kind)).map((kind) => {
            const a = m.agents.find((x) => x.kind === kind)
            const provider = view && a?.available ? choiceLabel(view, machineDefault(view, kind)) : null
            return (
              <span key={kind} className="machine__agent" data-available={!!a?.available}>
                <AgentIcon kind={kind} size={16} />
                {a?.available
                  ? `${AGENT_META[kind].name} ${a.version ?? ''}`.trim()
                  : `${AGENT_META[kind].name} ${agentsUndetected(m) ? t('待检测') : t('未安装')}`}
                {a && needsOfficialLogin(a, view) ? <Tag tone="orange">{t('未登录')}</Tag> : null}
                {provider ? <span className="mx-sub">{t('供应商：{name}', { name: provider })}</span> : null}
              </span>
            )
          })}
        </span>
        <span className="mx-sub machine-card__foot">
          {bots.length ? t('{n} 个 Bot · {k} 个运行中', { n: bots.length, k: running }) : t('没有 Bot')}
        </span>
      </Link>
      <Button
        size="small"
        icon="plus"
        className="machine-card__new"
        aria-label={t('在 {machine} 上新建 Bot', { machine: m.name })}
        onClick={() => onNewBot(m.id)}
      >
        {t('新建 Bot')}
      </Button>
    </div>
  )
}
