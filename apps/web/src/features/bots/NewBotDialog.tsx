import {
  type AgentKind,
  type BotAvatar,
  type BotDto,
  type BotOwnerDto,
  INHERIT_PROVIDER,
  type MachineDto,
  type UserDto,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import {
  Alert,
  Button,
  Dialog,
  Divider,
  Form,
  FormRow,
  type ModalAction,
  PopUpButton,
  Presence,
  RadioGroup,
  Spinner,
  TextField,
  toast,
} from '../../ui'
import { BindCodePanel, useBindCode } from '../machines/BindCodePanel'
import { OS_LABEL } from '../machines/BindMachineDialog'
import { providerBlocked } from '../machines/providers'
import { DirPicker } from '../workspaces/DirPicker'
import type { AgentConfig } from './AgentConfig'
import { RolePicker, roleHint } from './avatars'
import { ProviderModelFields, useMachineProviders, useProviderCatalog } from './BotProvider'
import { WorkspacePath } from './BotSettings'
import { AGENT_LABEL, AGENTS, botsApi, reportedAgent } from './model'

interface Props {
  me: UserDto
  onClose: () => void
  onCreated?: (bot: BotDto) => void
}

interface Draft {
  ownerId: string
  machineId: string | null
  agent: AgentKind
  name: string
  touched: boolean
  avatar: BotAvatar
  prompt: string
  /** Default workspace; only the owner may browse their own online machine (plan W1). */
  workspace: string | null
  /** Provider id, `official` or `inherit`; set on the machine with the bot. */
  provider: string
  config: AgentConfig
}

const NO_CONFIG: AgentConfig = { model: null, effort: null }

const autoName = (owner: BotOwnerDto, agent: AgentKind) =>
  t('{owner}的 {agent}', { owner: owner.name, agent: AGENT_LABEL[agent] })

function draftFor(owner: BotOwnerDto, machines: MachineDto[], prompt = ''): Draft {
  const m = machines[0]
  const agent = (m && AGENTS.find((k) => reportedAgent(m, k))) || 'claude'
  return {
    ownerId: owner.id,
    machineId: m?.id ?? null,
    agent,
    name: autoName(owner, agent),
    touched: false,
    avatar: 'role-gong',
    prompt,
    workspace: null,
    provider: INHERIT_PROVIDER,
    config: NO_CONFIG,
  }
}

/** 供应商 and 模型 of a new bot, offered as in its settings; others than the owner get what the machine reported. */
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
  onChange: (next: { provider: string; config: AgentConfig }) => void
}) {
  const reason = providerBlocked(meId, ownerId, machine)
  const [view] = useMachineProviders(machine.id, !!reason)
  const catalog = useProviderCatalog(machine.id, agent, reason ? null : provider)
  return (
    <ProviderModelFields
      reason={reason}
      view={view}
      agent={agent}
      provider={provider}
      catalog={reason ? (reportedAgent(machine, agent)?.catalog ?? null) : catalog}
      config={config}
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
      message={t('创建时直接绑定到归属人的机器')}
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

const RESULT_VARIANT = { pending: 'info', warn: 'warning', ok: 'success', confirm: 'info' } as const

/** What to do after creating: follows the live bot, so binding a machine or bringing it online updates it. */
function NextStep({ created, self }: { created: BotDto; self: boolean }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === created.id)) ?? created
  const bindHere = self && bot.binding === 'pending_bind'
  const bind = useBindCode(bindHere)
  const agent = AGENT_LABEL[bot.agentKind]
  const next: { tone: keyof typeof RESULT_VARIANT; desc: string } =
    bot.binding === 'pending_confirm'
      ? { tone: 'confirm', desc: t('已发送确认通知给 {name}', { name: bot.ownerName }) }
      : bot.binding === 'pending_bind'
        ? {
            tone: 'pending',
            desc: self
              ? t('在要运行 Bot 的机器上用共工空间客户端打开接入链接，绑定并上报 {agent} 后自动可用。', {
                  agent,
                })
              : t('{owner} 绑定第一台机器并上报 {agent} 后自动可用。', { owner: bot.ownerName, agent }),
          }
        : bot.presence === 'offline'
          ? {
              tone: 'warn',
              desc: t('机器 {machine} 当前离线，打开该机器上的共工空间客户端后即可使用', {
                machine: bot.machineName ?? '',
              }),
            }
          : bot.presence === 'agent_missing'
            ? {
                tone: 'warn',
                desc: t('{machine} 未上报 {agent}。在该机器安装并重新检测后自动可用。', {
                  machine: bot.machineName ?? '',
                  agent,
                }),
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
export function NewBotDialog({ me, onClose, onCreated }: Props) {
  const [owners, setOwners] = useState<BotOwnerDto[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<BotDto | null>(null)
  const [picking, setPicking] = useState<string | null | false>(false)
  const [more, setMore] = useState(false)
  const live = useWorkspace((s) => s.machines)
  const formId = useId()

  // Own machines come from the live store, so a daemon that just connected shows its agents right away.
  const machinesOf = (o: BotOwnerDto) => {
    const byId = new Map(o.machines.map((m) => [m.id, m]))
    for (const m of live) if (m.ownerId === o.id) byId.set(m.id, m)
    return [...byId.values()]
  }

  useEffect(() => {
    api
      .get<BotOwnerDto[]>('/bots/owners')
      .then((list) => {
        const sorted = [...list].sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id))
        setOwners(sorted)
        if (sorted[0]) setDraft(draftFor(sorted[0], sorted[0].machines))
      })
      .catch(toastError)
  }, [me.id])

  const owner = owners?.find((o) => o.id === draft?.ownerId)
  if (created)
    return (
      <Shell onClose={onClose} actions={[{ label: t('完成'), variant: 'primary', onClick: onClose }]}>
        <NextStep created={created} self={created.ownerId === me.id} />
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
  const agentName = AGENT_LABEL[draft.agent]
  const result: { tone: keyof typeof RESULT_VARIANT; title: string; desc: string } = !m
    ? {
        tone: 'pending',
        title: t('待绑定'),
        desc: t('{owner} 绑定第一台机器并上报 {agent} 后自动绑定，无需再操作；此前不能被触发。', {
          owner: owner.name,
          agent: agentName,
        }),
      }
    : !ver
      ? {
          tone: 'warn',
          title: t('绑定后暂不可用'),
          desc: t('{machine} 未上报 {agent}。在该机器安装并重新检测后自动可用。', {
            machine: m.name,
            agent: agentName,
          }),
        }
      : self
        ? {
            tone: 'ok',
            title: t('创建后立即可用'),
            desc: t(
              m.online
                ? '绑定到 {machine} · {agent} {version}，可直接拉入群触发。'
                : '绑定到 {machine} · {agent} {version}，可直接拉入群触发。机器当前离线，上线后开始执行。',
              { machine: m.name, agent: agentName, version: ver.version ?? '' },
            ),
          }
        : {
            tone: 'confirm',
            title: t('等待 {owner} 确认', { owner: owner.name }),
            desc: t('已绑定到 {machine}。机器上的操作由主人负责，{owner} 在 Web 通知中一键确认后即可触发。', {
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
          <FormRow label={t('归属人')} hint={t('系统管理员可为任何人创建；成员本人只能为自己创建。')}>
            <PopUpButton
              aria-label={t('归属人')}
              value={owner.id}
              options={owners.map((o) => ({
                value: o.id,
                label:
                  o.id === me.id
                    ? t('{name}（我）', { name: o.name })
                    : t('{name} · {n} 台机器', { name: o.name, n: machinesOf(o).length }),
              }))}
              onChange={(id) => {
                const o = owners.find((x) => x.id === id)
                if (o) setDraft(draftFor(o, machinesOf(o), draft.prompt))
              }}
            />
          </FormRow>
        ) : null}

        <FormRow label={t('名称')}>
          <TextField
            aria-label={t('名称')}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value, touched: true })}
          />
        </FormRow>

        <FormRow label={t('角色')} align="top" hint={roleHint(draft.avatar)}>
          <RolePicker value={draft.avatar} onChange={(avatar) => set({ avatar })} />
        </FormRow>

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
        <FormRow label={t('执行机器')} align={machines.length ? 'top' : 'center'}>
          {machines.length ? (
            <RadioGroup
              aria-label={t('执行机器')}
              value={m?.id}
              options={machines.map((x) => ({
                value: x.id,
                label: (
                  <span className="newbot__machine">
                    <span className="newbot__mono">{x.name}</span>
                    <span className="newbot__muted">
                      {OS_LABEL[x.os]} · {x.online ? t('在线') : t('离线')}
                    </span>
                  </span>
                ),
              }))}
              onChange={(id) => {
                const x = machines.find((y) => y.id === id)
                if (!x) return
                const agent = reportedAgent(x, draft.agent)
                  ? draft.agent
                  : (AGENTS.find((k) => reportedAgent(x, k)) ?? draft.agent)
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
              {t('{owner} 还没有绑定机器。Bot 会以「待绑定」创建，可先选 agent 种类。', {
                owner: owner.name,
              })}
            </span>
          )}
        </FormRow>

        <FormRow label="Agent" align="top">
          <RadioGroup
            aria-label="Agent"
            value={draft.agent}
            options={AGENTS.map((k) => {
              const v = m && reportedAgent(m, k)
              return {
                value: k,
                disabled: !!m && !v,
                label: (
                  <span className="newbot__machine">
                    {AGENT_LABEL[k]}
                    <span className={m && !v ? 'newbot__missing' : 'newbot__muted'}>
                      {!m ? '' : v ? (v.version ?? t('已安装')) : t('未安装')}
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
          <FormRow
            label={t('默认工作区')}
            hint={t('可选；未绑定仓库的群和私聊中自动使用，绑定仓库的群默认托管克隆。')}
          >
            <div className="newbot__inline">
              {draft.workspace ? (
                <WorkspacePath path={draft.workspace} onPick={setPicking} />
              ) : (
                <span className="newbot__muted">{t('未设置')}</span>
              )}
              <Button size="small" onClick={() => setPicking(draft.workspace)}>
                {t('选择目录…')}
              </Button>
            </div>
            <Presence>
              {picking !== false ? (
                <DirPicker
                  machineId={m.id}
                  title={t('默认工作区')}
                  start={picking}
                  onPick={(workspace) => {
                    set({ workspace })
                    setPicking(false)
                  }}
                  onClose={() => setPicking(false)}
                />
              ) : null}
            </Presence>
          </FormRow>
        ) : null}
      </Form>
      <Alert variant={RESULT_VARIANT[result.tone]} title={result.title} description={result.desc} />
    </Shell>
  )
}
