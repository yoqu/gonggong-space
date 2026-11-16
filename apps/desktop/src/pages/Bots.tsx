import { AGENT_META, type AgentState, type ProviderStoreView } from '@gonggong/protocol'
import { choiceLabel, machineDefault } from '@web/features/agents/model'
import { approvalText } from '@web/features/bots/ApprovalFields'
import { avatarSrc, faceOf } from '@web/features/bots/avatars'
import { Avatar, Button, EmptyState, GroupBox, GroupRow, Icon, Skeleton, Tag, type TagTone } from '@web/ui'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { ipc, type MachineBot } from '../ipc'
import { fail } from '../lib/ui'
import type { PageProps } from '.'

/** 「Kimi / kimi-k2」 of its own provider, else 「继承机器默认（X / 模型）」; the bot's own model wins either way. */
function providerText(b: MachineBot, view: ProviderStoreView) {
  const own = view.bots[b.id]
  const model = b.model ?? null
  if (own) return choiceLabel(view, { provider: own, model })
  const d = machineDefault(view, b.agentKind)
  return t('继承机器默认（{name}）', { name: choiceLabel(view, { ...d, model: model ?? d.model }) })
}

function status(b: MachineBot, agent: AgentState | undefined): { text: string; tone: TagTone } {
  if (b.binding === 'pending_confirm') return { text: t('待确认'), tone: 'orange' }
  if (!agent?.available || b.presence === 'agent_missing') return { text: t('agent 缺失'), tone: 'red' }
  if (b.presence === 'running') return { text: t('运行中'), tone: 'blue' }
  if (b.presence === 'online') return { text: t('在线'), tone: 'green' }
  return { text: t('离线'), tone: 'gray' }
}

/**
 * Everything is read-only here (plan J11, D3 of Agent管理重构): the bot's settings, its provider and model included,
 * are changed on the Web; the machine's providers and defaults on the Agent page.
 */
export function BotsPage({ go }: PageProps) {
  const [bots, setBots] = useState<MachineBot[] | null>(null)
  const [agents, setAgents] = useState<AgentState[]>([])
  const [providers, setProviders] = useState<ProviderStoreView | null>(null)

  useEffect(() => {
    ipc.bots().then(setBots, fail)
    ipc.tools().then((s) => setAgents(s.agents), fail)
    ipc.providers({ action: 'list' }).then((r) => setProviders(r.view ?? null), fail)
  }, [])

  return (
    <>
      {bots ? null : <Skeleton variant="conversation" count={3} />}
      {bots?.length === 0 ? (
        <EmptyState
          icon="bot"
          title={t('本机还没有 Bot')}
          description={t('在 Web 端创建 Bot 并指定到这台机器后，会显示在这里。')}
        />
      ) : null}
      {bots?.map((b) => {
        const agent = agents.find((a) => a.kind === b.agentKind)
        const badge = status(b, agent)
        const pending = b.binding === 'pending_confirm'
        const missing = !agent?.available
        const name = AGENT_META[b.agentKind].name
        return (
          <div key={b.id} className="dk-bot">
            <GroupBox>
              <div className="dk-row">
                <Avatar
                  name={b.name}
                  shape="square"
                  size={28}
                  src={avatarSrc(faceOf(b), b.presence === 'running')}
                />
                <div className="dk-row__main">
                  <span className="dk-row__title">
                    <span className="dk-strong">{b.name}</span>
                    <Tag tone={badge.tone}>{badge.text}</Tag>
                  </span>
                  {pending ? <span className="dk-sub">{t('他人为你创建，请在 Web 中确认')}</span> : null}
                </div>
                <Button
                  variant={pending ? 'primary' : undefined}
                  onClick={() => ipc.openBotInWeb(b.id).catch(fail)}
                >
                  {pending ? t('在 Web 中确认') : t('在 Web 中管理')}
                </Button>
              </div>
              {b.teamName ? <GroupRow label={t('团队')} value={b.teamName} /> : null}
              <GroupRow
                label="Agent"
                wideValue
                value={
                  missing ? (
                    <span className="dk-danger">{t('{name} · 未安装', { name })}</span>
                  ) : (
                    `${name} ${agent?.version ?? ''}`.trim()
                  )
                }
              />
              {providers ? (
                <GroupRow label={t('供应商/模型')} wideValue>
                  <span className="dk-inline">
                    {providerText(b, providers)}
                    <Button variant="plain" size="small" onClick={() => ipc.openBotInWeb(b.id).catch(fail)}>
                      {t('在 Web 中管理')}
                    </Button>
                  </span>
                </GroupRow>
              ) : null}
              <GroupRow label={t('并发上限')} value={b.concurrency} />
              <GroupRow label={t('审批方式')} wideValue value={approvalText(b)} />
              {missing ? (
                <div className="dk-row dk-warn">
                  <Icon name="warning" size={16} color="var(--system-red)" />
                  <span className="dk-row__main">{t('本机未安装 {name}，该 Bot 暂不能执行', { name })}</span>
                  <Button onClick={() => go('agents')}>{t('前往 Agent')}</Button>
                </div>
              ) : null}
            </GroupBox>
          </div>
        )
      })}
      {bots?.length ? (
        <p className="dk-footnote">
          {t(
            'Bot 的设置都在 Web 端管理（名称、角色说明、供应商与模型、并发上限、审批方式等）；本机的供应商与默认值在 Agent 页设置。',
          )}
        </p>
      ) : null}
    </>
  )
}
