import type { BotDto, MachineDto } from '@gonggong/protocol'
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import {
  Button,
  Dialog,
  EmptyState,
  Form,
  FormRow,
  Icon,
  type IconName,
  Presence,
  Tabs,
  TextField,
  toast,
} from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { AGENT_LABEL, PRESENCE } from '../bots/model'
import { OS_LABEL } from './BindMachineDialog'
import { ProvidersPanel } from './ProvidersPanel'
import { RevokeMachineDialog } from './RevokeMachineDialog'
import { ToolsPanel } from './ToolsPanel'

const GB = 1024 ** 3

export const osText = (m: MachineDto) => m.system?.osVersion ?? OS_LABEL[m.os]
const memoryText = (bytes: number | null | undefined) => (bytes ? `${Math.round(bytes / GB)} GB` : null)
const cpuText = (m: MachineDto) =>
  [m.system?.cpuModel, m.system?.cpuCores && `${m.system.cpuCores} 核`].filter(Boolean).join(' · ') || null
export const hardwareText = (m: MachineDto) =>
  [cpuText(m), memoryText(m.system?.memoryBytes)].filter(Boolean).join(' · ') || null
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '--')
const OS_ICON: Record<MachineDto['os'], IconName> = { macos: 'apple', linux: 'linux', windows: 'windows' }

type Tab = 'overview' | 'tools' | 'providers'
const TAB_NAME = { tools: 'Agent 工具', providers: '供应商' } as const

/** Why the machine's tools / providers cannot be managed live right now, if so. */
const blocked = (m: MachineDto, feature: 'tools' | 'providers') =>
  !m.online ? 'offline' : m.features.includes(feature) ? null : 'outdated'

function blockedNote(m: MachineDto) {
  if (!m.online) return '机器离线，上线后才能管理 Agent 工具与供应商'
  const old = (['tools', 'providers'] as const).filter((f) => blocked(m, f))
  return old.length ? `请先升级该机器的 daemon，才能管理${old.map((f) => TAB_NAME[f]).join('与')}` : null
}

/** Details of one machine; its owner or a sysadmin can rename or revoke it. */
export function MachineDialog({
  machine,
  ownerName,
  bots,
  onChanged,
  onClose,
}: {
  machine: MachineDto
  ownerName?: string
  /** Bots bound to this machine, when the caller has them. */
  bots?: BotDto[]
  /** Rename or revoke done: machine events reach only the owner, so a sysadmin's list must reload itself. */
  onChanged?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(machine.name === machine.hostname ? '' : machine.name)
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const owner = useSession((st) => st.user?.id === machine.ownerId)
  const formId = useId()
  const save = async () => {
    setSaving(true)
    try {
      const m = await api.patch<MachineDto>(`/machines/${machine.id}`, { name: name.trim() })
      toast({ type: 'success', message: `已重命名为 ${m.name}` })
      onChanged?.()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }
  const specs: [IconName, string, string | null][] = [
    ['cpu', 'CPU', cpuText(machine)],
    ['activity', '内存', memoryText(machine.system?.memoryBytes)],
    ['terminal', '内核', machine.system?.kernel ?? null],
    ['wifi', 'MAC 地址', machine.system?.macAddress ?? null],
  ]
  return (
    <>
      <Dialog
        open={!revoking}
        title="机器详情"
        message={machine.name}
        width={owner ? 600 : 520}
        onClose={onClose}
        footer={
          <Button variant="plain" className="machine__revoke" onClick={() => setRevoking(true)}>
            吊销机器
          </Button>
        }
        actions={[{ label: '完成', variant: 'primary', onClick: onClose }]}
      >
        {owner ? (
          <div className="machine__tabs">
            <Tabs<Tab>
              aria-label="机器详情"
              value={tab}
              onChange={setTab}
              items={[
                { value: 'overview', label: '概览' },
                { value: 'tools', label: TAB_NAME.tools, disabled: !!blocked(machine, 'tools') },
                { value: 'providers', label: TAB_NAME.providers, disabled: !!blocked(machine, 'providers') },
              ]}
            />
            {blockedNote(machine) ? <p className="machine__tabs-note">{blockedNote(machine)}</p> : null}
          </div>
        ) : null}
        {tab === 'overview' ? null : blocked(machine, tab) ? (
          <EmptyState
            compact
            title={blocked(machine, tab) === 'offline' ? '机器离线' : '请先升级该机器的 daemon'}
            description={
              blocked(machine, tab) === 'offline'
                ? '供应商与 Agent 工具只保存在机器上，机器上线后才能查看和修改。'
                : '当前 daemon 版本不支持在 Web 上管理，升级后即可使用。'
            }
          />
        ) : tab === 'tools' ? (
          <ToolsPanel machine={machine} />
        ) : (
          <ProvidersPanel machine={machine} />
        )}
        {tab === 'overview' ? (
          <div className="machine">
            <section className="machine__hero" data-os={machine.os}>
              <span className="machine__os">
                <Icon name={OS_ICON[machine.os]} size={30} label={OS_LABEL[machine.os]} />
              </span>
              <span className="machine__id">
                <span className="machine__host">{machine.hostname}</span>
                <span className="machine__tags">
                  <span className="machine__tag">{osText(machine)}</span>
                  <span className="machine__tag">{machine.arch}</span>
                  {machine.daemonVersion ? (
                    <span className="machine__tag">daemon v{machine.daemonVersion}</span>
                  ) : null}
                </span>
              </span>
              <span className="machine__status" data-online={machine.online}>
                {machine.online ? '在线' : '离线'}
              </span>
            </section>
            <Form id={formId} onSubmit={() => void save()}>
              <FormRow label="名称" hint="留空则使用主机名。">
                <span className="machine__rename">
                  <TextField
                    aria-label="名称"
                    value={name}
                    placeholder={machine.hostname}
                    maxLength={64}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Button type="submit" disabled={saving}>
                    保存
                  </Button>
                </span>
              </FormRow>
            </Form>
            <div className="machine__specs">
              {specs
                .filter((r): r is [IconName, string, string] => r[2] !== null)
                .map(([icon, k, v]) => (
                  <div key={k} className="machine__spec">
                    <Icon name={icon} size={18} className="machine__spec-icon" />
                    <span className="machine__spec-label">{k}</span>
                    <span className="machine__spec-value">{v}</span>
                  </div>
                ))}
            </div>
            <section className="machine__card" aria-label="Agent">
              <span className="machine__card-title">Agent</span>
              {machine.agents.length ? (
                machine.agents.map((a) => (
                  <span key={a.kind} className="machine__agent" data-available={a.available}>
                    <Icon name="bot" size={16} />
                    <span className="machine__agent-name">{AGENT_LABEL[a.kind]}</span>
                    <span className="machine__agent-version">
                      {a.available ? (a.version ?? '已安装') : '未安装'}
                    </span>
                  </span>
                ))
              ) : (
                <span className="machine__muted">未检测到 Agent</span>
              )}
            </section>
            {bots?.length ? (
              <section className="machine__card">
                <span className="machine__card-title">运行的 Bot</span>
                <ul className="machine__bots" aria-label="运行的 Bot">
                  {bots.map((b) => (
                    <li key={b.id}>
                      <Link to={`/bot/${b.id}`} className="machine__bot" onClick={onClose}>
                        <BotAvatar id={b.id} name={b.name} size={20} />
                        <span className="machine__agent-name">{b.name}</span>
                        <span className="machine__bot-state">
                          <span
                            className="machine__bot-dot"
                            style={{ background: PRESENCE[b.presence].color }}
                          />
                          {PRESENCE[b.presence].label}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <dl className="machine__meta">
              {ownerName ? (
                <>
                  <dt>主人</dt>
                  <dd>{ownerName}</dd>
                </>
              ) : null}
              {machine.online ? null : (
                <>
                  <dt>最后在线</dt>
                  <dd>{dateText(machine.lastSeenAt)}</dd>
                </>
              )}
              <dt>首次绑定</dt>
              <dd>{dateText(machine.createdAt)}</dd>
              <dt>最近绑定</dt>
              <dd>{dateText(machine.boundAt)}</dd>
            </dl>
          </div>
        ) : null}
      </Dialog>
      <Presence>
        {revoking ? (
          <RevokeMachineDialog
            machine={machine}
            onRevoked={() => {
              onChanged?.()
              onClose()
            }}
            onClose={() => setRevoking(false)}
          />
        ) : null}
      </Presence>
    </>
  )
}
