import { type BotDto, type MachineDto, OFFICIAL_PROVIDER, type ProviderStoreView } from '@gonggong/protocol'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { t } from '../../i18n'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import { Button, EmptyState, Icon, PickChatArt } from '../../ui'
import { AGENT_LABEL, AGENTS, isLaterAgent, reportedAgent } from '../bots/model'
import { OS_ICON } from './MachineDetails'
import { OS_LABEL } from './model'
import { providerName } from './providers'
import '../works/works.css'
import './machines.css'

/** /machines with nothing picked: a card per machine, or how to bind the first one. */
export function MachinesOverview({
  machines,
  bots,
  onBindMachine,
}: {
  machines: MachineDto[]
  bots: BotDto[]
  onBindMachine: () => void
}) {
  return (
    <section className="machines-overview" aria-label={t('机器总览')}>
      {/* The same page head as 市场 and 作品. */}
      <header className="works__head">
        <h1 className="works__title">{t('我的机器')}</h1>
        {machines.length ? <span className="works__count">{machines.length}</span> : null}
      </header>
      {machines.length ? (
        <div className="machines-overview__grid">
          {machines.map((m, i) => (
            <MachineCard key={m.id} index={i} machine={m} bots={bots.filter((b) => b.machineId === m.id)} />
          ))}
        </div>
      ) : (
        <EmptyState
          illustration={<PickChatArt />}
          title={t('还没有绑定机器')}
          description={t(
            '在一台装有 Claude Code、Codex 或 Gemini CLI 的机器上安装共工空间客户端并绑定，Bot 就在上面运行。',
          )}
          action={
            <Button variant="primary" icon="plus" onClick={onBindMachine}>
              {t('绑定新机器')}
            </Button>
          }
        />
      )}
    </section>
  )
}

function MachineCard({ machine: m, bots, index }: { machine: MachineDto; bots: BotDto[]; index: number }) {
  // Providers live on the machine alone: read live while it is online, never kept.
  const view = useGet<ProviderStoreView>(
    m.online && m.features.includes('providers') ? `/machines/${m.id}/providers` : null,
  ).data
  const running = bots.filter((b) => b.presence === 'running').length
  return (
    <Link
      to={`/machine/${m.id}`}
      className="machine-card"
      data-online={m.online}
      style={{ '--i': index } as CSSProperties}
    >
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
        {AGENTS.filter((kind) => !isLaterAgent(kind) || reportedAgent(m, kind)).map((kind) => {
          const a = m.agents.find((x) => x.kind === kind)
          const provider =
            view && a?.available ? providerName(view, view.machine[kind] ?? OFFICIAL_PROVIDER) : null
          return (
            <span key={kind} className="machine__agent" data-available={!!a?.available}>
              {a?.available
                ? `${AGENT_LABEL[kind]} ${a.version ?? ''}`.trim()
                : `${AGENT_LABEL[kind]} ${t('未安装')}`}
              {provider ? <span className="mx-sub">{t('供应商：{name}', { name: provider })}</span> : null}
            </span>
          )
        })}
      </span>
      <span className="mx-sub">
        {bots.length ? t('{n} 个 Bot · {k} 个运行中', { n: bots.length, k: running }) : t('没有 Bot')}
      </span>
    </Link>
  )
}
