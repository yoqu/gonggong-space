import type { AgentKind, BotAvatar, BotDto, BotOwnerDto, MachineDto, UserDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import {
  Alert,
  Button,
  Dialog,
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
import { OS_LABEL } from '../machines/BindMachineDialog'
import { DirPicker } from '../workspaces/DirPicker'
import { type AgentConfig, AgentConfigFields } from './AgentConfig'
import { AGENT_AVATAR, AvatarPicker } from './avatars'
import { WorkspacePath } from './BotsAdminPage'
import { AGENT_LABEL, AGENTS, BINDING_LABEL, botsApi, reportedAgent } from './model'

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
  /** null = follows the agent kind until picked. */
  avatar: BotAvatar | null
  prompt: string
  /** Default workspace; only the owner may browse their own online machine (plan W1). */
  workspace: string | null
  config: AgentConfig
}

const NO_CONFIG: AgentConfig = { model: null, effort: null }

const autoName = (owner: BotOwnerDto, agent: AgentKind) => `${owner.name}的 ${AGENT_LABEL[agent]}`

function draftFor(owner: BotOwnerDto, machines: MachineDto[], prompt = ''): Draft {
  const m = machines[0]
  const agent = (m && AGENTS.find((k) => reportedAgent(m, k))) || 'claude'
  return {
    ownerId: owner.id,
    machineId: m?.id ?? null,
    agent,
    name: autoName(owner, agent),
    touched: false,
    avatar: null,
    prompt,
    workspace: null,
    config: NO_CONFIG,
  }
}

function Shell({ onClose, cta, children }: { onClose: () => void; cta?: ModalAction; children: ReactNode }) {
  return (
    <Dialog
      open
      width={540}
      title="新建 Bot"
      message="创建时直接绑定到归属人的机器"
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: '取消', onClick: onClose },
        cta ?? { label: '创建', variant: 'primary', disabled: true },
      ]}
    >
      {children}
    </Dialog>
  )
}

const RESULT_VARIANT = { pending: 'info', warn: 'warning', ok: 'success', confirm: 'info' } as const

/** 新建 Bot (管理后台.dc.html): owner → machine → agent → name/prompt, previewing the resulting binding. */
export function NewBotDialog({ me, onClose, onCreated }: Props) {
  const [owners, setOwners] = useState<BotOwnerDto[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<string | null | false>(false)
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
      .catch((e: Error) => toast({ type: 'error', message: e.message }))
  }, [me.id])

  const owner = owners?.find((o) => o.id === draft?.ownerId)
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
  const catalog = ver?.catalog ?? null
  const agentName = AGENT_LABEL[draft.agent]
  const result: { tone: keyof typeof RESULT_VARIANT; title: string; desc: string } = !m
    ? {
        tone: 'pending',
        title: '待绑定',
        desc: `${owner.name} 绑定第一台机器并上报 ${agentName} 后自动绑定，无需再操作；此前不能被触发。`,
      }
    : !ver
      ? {
          tone: 'warn',
          title: '绑定后暂不可用',
          desc: `${m.name} 未上报 ${agentName}。在该机器安装并重新检测后自动可用。`,
        }
      : self
        ? {
            tone: 'ok',
            title: '创建后立即可用',
            desc: `绑定到 ${m.name} · ${agentName} ${ver.version ?? ''}，可直接拉入群触发。${m.online ? '' : '机器当前离线，上线后开始执行。'}`,
          }
        : {
            tone: 'confirm',
            title: `等待 ${owner.name} 确认`,
            desc: `已绑定到 ${m.name}。机器上的操作由主人负责，${owner.name} 在 daemon 或 Web 通知中一键确认后即可触发。`,
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
      })
      if (draft.workspace)
        await botsApi
          .setDefaultWorkspace(bot.id, draft.workspace)
          .catch((e: Error) => toast({ type: 'error', message: `默认工作区未设置：${e.message}` }))
      toast({ type: 'success', message: `${bot.name} 已创建 · ${BINDING_LABEL[bot.binding]}` })
      onCreated?.(bot)
      onClose()
    } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
      setBusy(false)
    }
  }

  return (
    <Shell
      onClose={onClose}
      cta={{
        label: !m ? '创建' : self ? '创建并绑定' : '创建并发送确认',
        variant: 'primary',
        type: 'submit',
        form: formId,
        disabled: !draft.name.trim() || busy,
      }}
    >
      <Form id={formId} onSubmit={() => void create()}>
        <FormRow label="归属人" hint="系统管理员可为任何人创建；成员本人只能为自己创建。">
          <PopUpButton
            aria-label="归属人"
            value={owner.id}
            options={owners.map((o) => ({
              value: o.id,
              label: o.id === me.id ? `${o.name}（我）` : `${o.name} · ${machinesOf(o).length} 台机器`,
            }))}
            onChange={(id) => {
              const o = owners.find((x) => x.id === id)
              if (o) setDraft(draftFor(o, machinesOf(o), draft.prompt))
            }}
          />
        </FormRow>

        <FormRow label="执行机器" align={machines.length ? 'top' : 'center'}>
          {machines.length ? (
            <RadioGroup
              aria-label="执行机器"
              value={m?.id}
              options={machines.map((x) => ({
                value: x.id,
                label: (
                  <span className="newbot__machine">
                    <span className="newbot__mono">{x.name}</span>
                    <span className="newbot__muted">
                      {OS_LABEL[x.os]} · {x.online ? '在线' : '离线'}
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
                set({ machineId: x.id, agent, workspace: null, config: NO_CONFIG, ...named(agent) })
              }}
            />
          ) : (
            <span className="newbot__muted">
              {owner.name} 还没有绑定机器。Bot 会以「待绑定」创建，可先选 agent 种类。
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
                      {!m ? '' : v ? (v.version ?? '已安装') : '未安装'}
                    </span>
                  </span>
                ),
              }
            })}
            onChange={(k) => set({ agent: k, config: NO_CONFIG, ...named(k) })}
          />
        </FormRow>

        {m ? (
          <AgentConfigFields catalog={catalog} value={draft.config} onChange={(config) => set({ config })} />
        ) : null}

        <FormRow label="名称">
          <TextField
            aria-label="名称"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value, touched: true })}
          />
        </FormRow>

        <FormRow label="头像" align="top">
          <AvatarPicker
            value={draft.avatar ?? AGENT_AVATAR[draft.agent]}
            onChange={(avatar) => set({ avatar })}
          />
        </FormRow>

        <FormRow label="系统提示词" align="top" hint="同时作为群内简介。">
          <TextField
            multiline
            aria-label="系统提示词"
            rows={3}
            value={draft.prompt}
            placeholder="后端接口开发，只改 server/ 目录"
            onChange={(e) => set({ prompt: e.target.value })}
          />
        </FormRow>

        {self && m?.online ? (
          <FormRow label="默认工作区" hint="可选；不设置则进群时再选择。">
            {draft.workspace ? (
              <WorkspacePath path={draft.workspace} onPick={setPicking} />
            ) : (
              <span className="newbot__muted">未设置</span>
            )}
            <Button size="small" onClick={() => setPicking(draft.workspace)}>
              选择目录…
            </Button>
            <Presence>
              {picking !== false ? (
                <DirPicker
                  machineId={m.id}
                  title="默认工作区"
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
