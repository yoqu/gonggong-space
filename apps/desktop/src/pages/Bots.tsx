import { avatarSrc } from '@web/features/bots/avatars'
import {
  Avatar,
  Button,
  EmptyState,
  GroupBox,
  GroupRow,
  Icon,
  PopUpButton,
  Skeleton,
  Tag,
  type TagTone,
} from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { type AgentCard, ipc, type MachineBot, type Providers } from '../ipc'
import { AGENTS, APPROVAL } from '../lib/labels'
import { fail } from '../lib/ui'
import { OFFICIAL, OFFICIAL_NAME } from '../providers/ProviderBox'
import { useProviderSwitch } from '../providers/switch'
import type { PageProps } from '.'

const INHERIT = 'inherit'

/** 继承机器（当前：X） / 官方登录 / this machine's providers of the bot's agent. */
function providerOptions(b: MachineBot, p: Providers) {
  const name = (id: string) =>
    id === OFFICIAL ? OFFICIAL_NAME : (p.providers.find((x) => x.id === id)?.name ?? id)
  return [
    { value: INHERIT, label: `继承机器（当前：${name(p.machine[b.agentKind] ?? OFFICIAL)}）` },
    { value: OFFICIAL, label: OFFICIAL_NAME },
    ...p.providers.filter((x) => x.agent === b.agentKind).map((x) => ({ value: x.id, label: x.name })),
  ]
}

function status(b: MachineBot, agent: AgentCard | undefined): { text: string; tone: TagTone } {
  if (b.binding === 'pending_confirm') return { text: '待确认', tone: 'orange' }
  if (!agent?.available || b.presence === 'agent_missing') return { text: 'agent 缺失', tone: 'red' }
  if (b.presence === 'running') return { text: '运行中', tone: 'blue' }
  if (b.presence === 'online') return { text: '在线', tone: 'green' }
  return { text: '离线', tone: 'gray' }
}

/**
 * Server settings are read-only here (plan J11), changed on the Web; the provider is machine-local (design §4.2),
 * so it is chosen here.
 */
export function BotsPage({ go }: PageProps) {
  const [bots, setBots] = useState<MachineBot[] | null>(null)
  const [agents, setAgents] = useState<AgentCard[]>([])
  const [providers, setProviders] = useState<Providers | null>(null)
  const loadProviders = useCallback(() => ipc.providers().then(setProviders, fail), [])
  const switcher = useProviderSwitch(loadProviders)

  useEffect(() => {
    ipc.bots().then(setBots, fail)
    ipc.agents().then(setAgents, fail)
    loadProviders()
  }, [loadProviders])

  return (
    <>
      {bots ? null : <Skeleton variant="conversation" count={3} />}
      {bots?.length === 0 ? (
        <EmptyState
          icon="bot"
          title="本机还没有 Bot"
          description="在 Web 端创建 Bot 并指定到这台机器后，会显示在这里。"
        />
      ) : null}
      {bots?.map((b) => {
        const agent = agents.find((a) => a.kind === b.agentKind)
        const badge = status(b, agent)
        const pending = b.binding === 'pending_confirm'
        const missing = !agent?.available
        const name = AGENTS[b.agentKind].name
        return (
          <div key={b.id} className="dk-bot">
            <GroupBox>
              <div className="dk-row">
                <Avatar
                  name={b.name}
                  shape="square"
                  size={28}
                  src={avatarSrc(b.avatar, b.presence === 'running')}
                />
                <div className="dk-row__main">
                  <span className="dk-row__title">
                    <span className="dk-strong">{b.name}</span>
                    <Tag tone={badge.tone}>{badge.text}</Tag>
                  </span>
                  {pending ? <span className="dk-sub">他人为你创建，请在 Web 中确认</span> : null}
                </div>
                <Button
                  variant={pending ? 'primary' : undefined}
                  onClick={() => ipc.openBotInWeb(b.id).catch(fail)}
                >
                  {pending ? '在 Web 中确认' : '在 Web 中管理'}
                </Button>
              </div>
              <GroupRow
                label="Agent"
                wideValue
                value={
                  missing ? (
                    <span className="dk-danger">{`${name} · 未安装`}</span>
                  ) : (
                    `${name} ${agent?.version ?? ''}`.trim()
                  )
                }
              />
              {providers ? (
                <GroupRow label="供应商" description="只保存在本机，进行中的会话开启新会话后才切换">
                  <PopUpButton
                    aria-label={`${b.name} 的供应商`}
                    options={providerOptions(b, providers)}
                    value={providers.bots[b.id] ?? INHERIT}
                    onChange={(v) => switcher.request(b.agentKind, v, b.id)}
                  />
                </GroupRow>
              ) : null}
              <GroupRow label="并发上限" value={b.concurrency} />
              <GroupRow label="命令审批" value={APPROVAL[b.approval]} />
              {b.approval === 'allowlist' ? (
                <GroupRow
                  label="命令白名单"
                  wideValue
                  value={b.allowlist.length ? b.allowlist.join('、') : '（空）'}
                />
              ) : null}
              {missing ? (
                <div className="dk-row dk-warn">
                  <Icon name="warning" size={16} color="var(--system-red)" />
                  <span className="dk-row__main">本机未安装 {name}，该 Bot 暂不能执行</span>
                  <Button onClick={() => go('agents')}>前往 Agent</Button>
                </div>
              ) : null}
            </GroupBox>
          </div>
        )
      })}
      {bots?.length ? (
        <p className="dk-footnote">
          供应商只保存在本机，在这里设置；Bot 的其余设置都在 Web
          端管理（名称、角色说明、模型、并发上限、命令审批与白名单等）。
        </p>
      ) : null}
      {switcher.dialog}
    </>
  )
}
