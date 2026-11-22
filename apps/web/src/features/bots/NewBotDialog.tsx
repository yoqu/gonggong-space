import {
  AGENT_KINDS,
  AGENT_META,
  type AgentKind,
  type BotDto,
  type BotOwnerDto,
  type BotRole,
  INHERIT_PROVIDER,
  type MachineDto,
  type UserDto,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  AgentIcon,
  Alert,
  Avatar,
  Button,
  Dialog,
  Divider,
  Form,
  FormRow,
  type ModalAction,
  PopUpButton,
  RadioGroup,
  Spinner,
  TextField,
  toast,
} from '../../ui'
import { BindCodePanel, useBindCode } from '../machines/BindCodePanel'
import { OS_LABEL } from '../machines/model'
import { providerBlocked } from '../machines/providers'
import type { AgentConfig } from './AgentConfig'
import { avatarSrc, RolePicker, roleFace, roleHint } from './avatars'
import {
  choiceProvider,
  type ProviderModel,
  ProviderModelFields,
  useMachineProviders,
  useProviderCatalog,
} from './BotProvider'
import { DefaultWorkspaceRow } from './DefaultWorkspaceField'
import { agentsUndetected, agentUnavailableText, botsApi, clientRuns, reportedAgent } from './model'
import { useDm } from './ShareRequest'
import './bots.css'

interface Props {
  me: UserDto
  /** Preselected when it is one of the first owner's machines (opened right after binding it). */
  machineId?: string
  onClose: () => void
  onCreated?: (bot: BotDto) => void
}

interface Draft {
  ownerId: string
  machineId: string | null
  agent: AgentKind
  name: string
  touched: boolean
  avatar: BotRole
  prompt: string
  /** Default workspace; only the owner may browse their own online machine (plan W1). */
  workspace: string | null
  /** Provider id, `official` or `inherit`; set on the machine with the bot. */
  provider: string
  config: AgentConfig
}

const NO_CONFIG: AgentConfig = { model: null, effort: null }

const autoName = (owner: BotOwnerDto, agent: AgentKind) =>
  t('{owner}的 {agent}', { owner: owner.name, agent: AGENT_META[agent].name })

function draftFor(owner: BotOwnerDto, machines: MachineDto[], prompt = '', pickedId?: string): Draft {
  const m = machines.find((x) => x.id === pickedId) ?? machines.find((x) => x.online) ?? machines[0]
  const agent = (m && AGENT_KINDS.find((k) => reportedAgent(m, k))) || 'claude'
  return {
    ownerId: owner.id,
    machineId: m?.id ?? null,
    agent,
    name: autoName(owner, agent),
    touched: false,
    avatar: 'role-agent',
    prompt,
    workspace: null,
    provider: INHERIT_PROVIDER,
    config: NO_CONFIG,
  }
}

/** 供应商/模型 of a new bot, offered as in its settings; others than the owner get what the machine reported. */
function NewBotProviderFields({
  machine,
  meId,
  ownerId,
  agent,
  provider,
  config,
  onChange,
}: {
  machine: MachineDto
  meId: string
  ownerId: string
  agent: AgentKind
  provider: string
  config: AgentConfig
  onChange: (next: ProviderModel) => void
}) {
  const reason = providerBlocked(meId, ownerId, machine)
  const [view] = useMachineProviders(machine.id, !!reason)
  const catalog = useProviderCatalog(
    machine.id,
    agent,
    reason || !view ? null : choiceProvider(view, agent, provider),
  )
  return (
    <ProviderModelFields
      reason={reason}
      view={view}
      machine={machine}
      agent={agent}
      value={{ provider, config }}
      catalog={reason ? (reportedAgent(machine, agent)?.catalog ?? null) : catalog}
      onChange={onChange}
    />
  )
}

function Shell({
  onClose,
  cta,
  actions,
  children,
}: {
  onClose: () => void
  cta?: ModalAction
  actions?: ModalAction[]
  children: ReactNode
}) {
  return (
    <Dialog
      open
      width={540}
      title={t('新建 Bot')}
      message={t('创建时直接绑定到 Bot 主人的电脑')}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={
        actions ?? [
          { label: t('取消'), onClick: onClose },
          cta ?? { label: t('创建'), variant: 'primary', disabled: true },
        ]
      }
    >
      {children}
    </Dialog>
  )
}

const RESULT_VARIANT = {
  pending: 'info',
  warn: 'warning',
  ok: 'success',
  offline: 'info',
  confirm: 'info',
} as const

/** What to do after creating: follows the live bot, so binding a machine or bringing it online updates it. */
function NextStep({ bot, self }: { bot: BotDto; self: boolean }) {
  const bindHere = self && bot.binding === 'pending_bind'
  const bind = useBindCode(bindHere)
  const machine = useWorkspace((s) => s.machines.find((m) => m.id === bot.machineId))
  const agent = AGENT_META[bot.agentKind].name
  const next: { tone: keyof typeof RESULT_VARIANT; desc: string } =
    bot.binding === 'pending_confirm'
      ? { tone: 'confirm', desc: t('已发送确认通知给 {name}', { name: bot.ownerName }) }
      : bot.binding === 'pending_bind'
        ? {
            tone: 'pending',
            desc: self
              ? t('在要运行 Bot 的电脑上用共工空间客户端打开接入链接，绑定并上报 {agent} 后自动可用。', {
                  agent,
                })
              : t('{owner} 绑定第一台电脑并上报 {agent} 后自动可用。', { owner: bot.ownerName, agent }),
          }
        : bot.presence === 'offline'
          ? {
              tone: 'warn',
              desc: t('电脑 {machine} 当前离线，打开这台电脑上的共工空间客户端后即可使用', {
                machine: bot.machineName ?? '',
              }),
            }
          : bot.presence === 'agent_missing'
            ? {
                tone: 'warn',
                desc: agentUnavailableText(machine, agent, bot.machineName ?? ''),
              }
            : { tone: 'ok', desc: t('已就绪，可以在群里 @ 它了') }
  return (
    <>
      <Alert
        variant={RESULT_VARIANT[next.tone]}
        title={t('{name} 已创建', { name: bot.name })}
        description={next.desc}
      />
      {bindHere ? <BindCodePanel bind={bind} /> : null}
    </>
  )
}

/** 新建 Bot (管理后台.dc.html): who and what it is, then where it runs, previewing the resulting binding. */
export function NewBotDialog({ me, machineId, onClose, onCreated }: Props) {
  const ownersReq = useGet<BotOwnerDto[]>('/bots/owners')
  const owners = useMemo(
    () =>
      ownersReq.data
        ? [...ownersReq.data].sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id))
        : null,
    [ownersReq.data, me.id],
  )
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<BotDto | null>(null)
  const [more, setMore] = useState(false)
  const [roles, setRoles] = useState(false)
  const liveMachines = useWorkspace((s) => s.machines)
  const live = useWorkspace((s) => s.bots.find((b) => b.id === created?.id)) ?? created
  const openDm = useDm(live)
  const formId = useId()

  // Own machines come from the live store, so a daemon that just connected shows its agents right away.
  const machinesOf = (o: BotOwnerDto) => {
    const byId = new Map(o.machines.map((m) => [m.id, m]))
    for (const m of liveMachines) if (m.ownerId === o.id) byId.set(m.id, m)
    return [...byId.values()]
  }

  useEffect(() => {
    const first = owners?.[0]
    if (!first) return
    setDraft((prev) => prev ?? draftFor(first, first.machines, '', machineId))
  }, [owners, machineId])

  const owner = owners?.find((o) => o.id === draft?.ownerId)
  if (created && live) {
    const self = created.ownerId === me.id
    const done: ModalAction = { label: t('完成'), onClick: onClose }
    const chat: ModalAction = { label: t('和它聊一句'), onClick: () => void openDm().then(onClose) }
    // My own bot once ready leads straight into a DM with it: the shortest way to a first conversation. Not ready
    // yet (machine offline, agent not reported), 完成 leads and a chat only waits.
    const ready = live.presence !== 'offline' && live.presence !== 'agent_missing'
    return (
      <Shell
        onClose={onClose}
        actions={
          !self || live.binding === 'pending_bind'
            ? [{ ...done, variant: 'primary' }]
            : ready
              ? [done, { ...chat, variant: 'primary' }]
              : [chat, { ...done, variant: 'primary' }]
        }
      >
        <NextStep bot={live} self={self} />
      </Shell>
    )
  }
  if (ownersReq.error && !owners)
    return (
      <Shell onClose={onClose}>
        <Alert
          variant="error"
          title={t('加载失败')}
          description={ownersReq.error}
          retrying={ownersReq.loading}
          onRetry={ownersReq.reload}
        />
      </Shell>
    )
  if (!owners || !draft || !owner)
    return (
      <Shell onClose={onClose}>
        <div className="newbot__loading">
          <Spinner />
        </div>
      </Shell>
    )

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const named = (agent: AgentKind) => (draft.touched ? {} : { name: autoName(owner, agent) })
  const machines = machinesOf(owner)
  const m = machines.find((x) => x.id === draft.machineId)
  const self = owner.id === me.id
  const ver = m && reportedAgent(m, draft.agent)
  const agentName = AGENT_META[draft.agent].name
  const result: { tone: keyof typeof RESULT_VARIANT; title: string; desc: string } = !m
    ? {
        tone: 'pending',
        title: t('待绑定'),
        desc: t('{owner} 绑定第一台电脑并上报 {agent} 后会自动绑定；此前还不能被触发。', {
          owner: owner.name,
          agent: agentName,
        }),
      }
    : !ver
      ? {
          tone: 'warn',
          title: t('绑定后暂不可用'),
          desc: agentUnavailableText(m, agentName),
        }
      : self
        ? {
            tone: m.online ? 'ok' : 'offline',
            title: m.online ? t('创建后立即可用') : t('创建后可拉入群'),
            desc: t(
              m.online
                ? '绑定到 {machine} · {agent} {version}，可直接拉入群触发。'
                : '绑定到 {machine} · {agent} {version}，可直接拉入群触发。电脑当前离线，上线后开始执行。',
              { machine: m.name, agent: agentName, version: ver.version ?? '' },
            ),
          }
        : {
            tone: 'confirm',
            title: t('等待 {owner} 确认', { owner: owner.name }),
            desc: t('已绑定到 {machine}。电脑上的操作由主人负责，{owner} 在通知里确认后即可触发。', {
              machine: m.name,
              owner: owner.name,
            }),
          }

  const create = async () => {
    if (!draft.name.trim() || busy) return
    setBusy(true)
    try {
      const bot = await botsApi.create({
        name: draft.name.trim(),
        ownerId: owner.id,
        agentKind: draft.agent,
        machineId: m?.id ?? null,
        systemPrompt: draft.prompt,
        avatar: draft.avatar,
        ...draft.config,
        ...(draft.provider !== INHERIT_PROVIDER && { provider: draft.provider }),
      })
      if (draft.workspace)
        await botsApi
          .setDefaultWorkspace(bot.id, draft.workspace)
          .catch((e: Error) =>
            toast({ type: 'error', message: t('默认工作区未设置：{error}', { error: e.message }) }),
          )
      onCreated?.(bot)
      setCreated(bot)
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }

  return (
    <Shell
      onClose={onClose}
      cta={{
        label: !m ? t('创建') : self ? t('创建并绑定') : t('创建并发送确认'),
        variant: 'primary',
        type: 'submit',
        form: formId,
        disabled: !draft.name.trim() || busy,
      }}
    >
      <Form id={formId} onSubmit={() => void create()}>
        <Divider label={t('基本信息')} />
        {owners.length > 1 ? (
          <FormRow label={t('Bot 主人')} hint={t('系统管理员可为任何人创建；成员本人只能为自己创建。')}>
            <PopUpButton
              aria-label={t('Bot 主人')}
              value={owner.id}
              options={owners.map((o) => ({
                value: o.id,
                label:
                  o.id === me.id
                    ? t('{name}（我）', { name: o.name })
                    : t('{name} · {n} 台电脑', { name: o.name, n: machinesOf(o).length }),
              }))}
              onChange={(id) => {
                const o = owners.find((x) => x.id === id)
                if (o) setDraft(draftFor(o, machinesOf(o), draft.prompt))
              }}
            />
          </FormRow>
        ) : null}

        <FormRow label={t('名称')}>
          <div className="newbot__inline newbot__name">
            <Avatar
              name={draft.name}
              shape="square"
              size={32}
              src={avatarSrc(roleFace(draft.avatar, draft.agent))}
            />
            <TextField
              aria-label={t('名称')}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value, touched: true })}
            />
          </div>
        </FormRow>

        {roles ? (
          <FormRow label={t('角色')} align="top" hint={roleHint(draft.avatar, draft.agent)}>
            <RolePicker value={draft.avatar} agent={draft.agent} onChange={(avatar) => set({ avatar })} />
          </FormRow>
        ) : (
          <FormRow hint={t('默认用 Agent 的形象，一眼看出是哪家')}>
            <Button size="small" onClick={() => setRoles(true)}>
              {t('换个角色…')}
            </Button>
          </FormRow>
        )}

        <FormRow label={t('系统提示词')} align="top" hint={t('同时作为群内简介。')}>
          <TextField
            multiline
            aria-label={t('系统提示词')}
            rows={3}
            value={draft.prompt}
            placeholder={t('后端接口开发，只改 server/ 目录')}
            onChange={(e) => set({ prompt: e.target.value })}
          />
        </FormRow>

        <Divider label={t('运行配置')} />
        <FormRow label={t('运行电脑')} align={machines.length ? 'top' : 'center'}>
          {machines.length ? (
            <RadioGroup
              aria-label={t('运行电脑')}
              value={m?.id}
              options={(() => {
                const counts = new Map<string, number>()
                for (const x of machines) counts.set(x.name, (counts.get(x.name) ?? 0) + 1)
                return machines.map((x) => {
                  const dup = (counts.get(x.name) ?? 0) > 1
                  const extra = dup
                    ? !x.online && x.lastSeenAt
                      ? ` · ${t('最后在线 {time}', { time: ago(x.lastSeenAt) })}`
                      : ` · #${x.id.slice(0, 4)}`
                    : ''
                  return {
                    value: x.id,
                    label: (
                      <span className="newbot__machine">
                        <span>{x.name}</span>
                        <span className="newbot__muted">
                          {OS_LABEL[x.os]} · {x.online ? t('在线') : t('离线')}
                          {extra}
                        </span>
                      </span>
                    ),
                  }
                })
              })()}
              onChange={(id) => {
                const x = machines.find((y) => y.id === id)
                if (!x) return
                const agent = reportedAgent(x, draft.agent)
                  ? draft.agent
                  : (AGENT_KINDS.find((k) => reportedAgent(x, k)) ?? draft.agent)
                set({
                  machineId: x.id,
                  agent,
                  workspace: null,
                  provider: INHERIT_PROVIDER,
                  config: NO_CONFIG,
                  ...named(agent),
                })
              }}
            />
          ) : (
            <span className="newbot__muted">
              {t('{owner} 还没有绑定电脑。Bot 会以「待绑定」状态创建，可先选择 Agent 种类。', {
                owner: owner.name,
              })}
            </span>
          )}
        </FormRow>

        <FormRow label="Agent" align="top">
          <RadioGroup
            aria-label="Agent"
            value={draft.agent}
            // An online machine whose client is too old for an agent still lists it, greyed, saying why.
            options={AGENT_KINDS.filter((k) => clientRuns(m, k) || m?.online).map((k) => {
              const outdated = !clientRuns(m, k)
              const v = m && reportedAgent(m, k)
              const unknown = !!m && agentsUndetected(m)
              const missing = outdated || (!!m && !v && !unknown)
              return {
                value: k,
                disabled: missing,
                label: (
                  <span className="newbot__machine">
                    <AgentIcon kind={k} size={16} className="newbot__agent-face" />
                    {AGENT_META[k].name}
                    <span className={missing ? 'newbot__missing' : 'newbot__muted'}>
                      {outdated
                        ? t('客户端需升级')
                        : !m
                          ? ''
                          : v
                            ? (v.version ?? t('已安装'))
                            : unknown
                              ? t('待检测')
                              : t('未安装')}
                    </span>
                  </span>
                ),
              }
            })}
            onChange={(k) => set({ agent: k, provider: INHERIT_PROVIDER, config: NO_CONFIG, ...named(k) })}
          />
        </FormRow>

        {m && !more ? (
          <FormRow hint={t('都可以在创建后的 Bot 设置里修改')}>
            <Button size="small" onClick={() => setMore(true)}>
              {t('设置供应商、模型与默认工作区…')}
            </Button>
          </FormRow>
        ) : null}
        {m && more ? (
          <NewBotProviderFields
            machine={m}
            meId={me.id}
            ownerId={owner.id}
            agent={draft.agent}
            provider={draft.provider}
            config={draft.config}
            onChange={set}
          />
        ) : null}

        {more && self && m?.online ? (
          <DefaultWorkspaceRow
            machineId={m.id}
            value={draft.workspace}
            hint={t('可选；未绑定仓库的群和私聊中自动使用，绑定仓库的群默认自动克隆。')}
            pickLabel={t('选择目录…')}
            onChange={(workspace) => set({ workspace })}
          />
        ) : null}
      </Form>
      <div className={result.tone === 'offline' ? 'newbot__alert--neutral' : undefined}>
        <Alert variant={RESULT_VARIANT[result.tone]} title={result.title} description={result.desc} />
      </div>
    </Shell>
  )
}
