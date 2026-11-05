import type { BotDto, ClientDownloads, MachineDto } from '@gonggong/protocol'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Disclosure, EmptyState, Icon, type IconName, Tabs, TextField, toast } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { AGENT_LABEL, PRESENCE } from '../bots/model'
import { CommandLine, DiagnosticsPanel, UpgradeGuide, upgradable, WorkspacesPanel } from './AdminPanels'
import { AgentsPanel } from './AgentsPanel'
import { OS_LABEL } from './model'

const GB = 1024 ** 3

export const osText = (m: MachineDto) => m.system?.osVersion ?? OS_LABEL[m.os]
const memoryText = (bytes: number | null | undefined) => (bytes ? `${Math.round(bytes / GB)} GB` : null)
const cpuText = (m: MachineDto) =>
  [m.system?.cpuModel, m.system?.cpuCores && t('{n} 核', { n: m.system.cpuCores })]
    .filter(Boolean)
    .join(' · ') || null
export const hardwareText = (m: MachineDto) =>
  [cpuText(m), memoryText(m.system?.memoryBytes)].filter(Boolean).join(' · ') || null
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '--')
export const OS_ICON: Record<MachineDto['os'], IconName> = {
  macos: 'apple',
  linux: 'linux',
  windows: 'windows',
}

type Tab = 'overview' | 'agents' | 'workspaces' | 'diagnostics'
type Part = 'tools' | 'providers' | 'agent' | 'workspaces' | 'logs'
const PART_NAME: Record<Part, string> = {
  tools: t('Agent 工具'),
  providers: t('供应商#nav'),
  agent: t('Agent 设置'),
  workspaces: t('工作区#tab'),
  logs: t('日志'),
}
const PART_FEATURE = {
  tools: 'tools',
  providers: 'providers',
  agent: 'agentSettings',
  workspaces: 'machineAdmin',
  logs: 'machineAdmin',
} as const
const TAB_PARTS: Record<Exclude<Tab, 'overview'>, Part[]> = {
  agents: ['tools', 'providers', 'agent'],
  workspaces: ['workspaces'],
  diagnostics: ['tools', 'logs'],
}
/** `?tab=` values, old ones included (the desktop app's 在 Web 中管理 links to providers). */
const TAB_ALIAS: Record<string, Tab> = {
  overview: 'overview',
  agents: 'agents',
  providers: 'agents',
  agent: 'agents',
  tools: 'agents',
  workspaces: 'workspaces',
  diagnostics: 'diagnostics',
}

const outdated = (m: MachineDto, part: Part) => !m.features.includes(PART_FEATURE[part])

/** An online machine whose daemon is too old for all of a section; offline sections stay open to explain. */
const blocked = (m: MachineDto, tab: Exclude<Tab, 'overview'>) =>
  m.online && TAB_PARTS[tab].every((p) => outdated(m, p))

function blockedNote(m: MachineDto) {
  if (!m.online) return t('机器离线，上线后才能管理 Agent 与供应商、工作区和诊断')
  const old = (Object.keys(PART_NAME) as Part[]).filter((p) => outdated(m, p)).map((p) => PART_NAME[p])
  const last = old.pop()
  if (!last) return null
  const what = old.length ? `${old.join(t('、'))}${t('与')}${last}` : last
  return t('请先升级该机器的 daemon，才能管理{what}', { what })
}

/** The machine's name with a pencil to rename it in place: Enter saves, Esc cancels; empty falls back to the hostname. */
export function MachineName({ machine, onChanged }: { machine: MachineDto; onChanged?: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Set once Enter or Esc has decided, so the blur that follows does not decide again.
  const settled = useRef(false)
  const initial = machine.name === machine.hostname ? '' : machine.name
  const save = async (name: string) => {
    settled.current = true
    setSaving(true)
    try {
      const m = await api.patch<MachineDto>(`/machines/${machine.id}`, { name: name.trim() })
      toast({ type: 'success', message: t('已重命名为 {name}', { name: m.name }) })
      setDraft(null)
      onChanged?.()
    } catch (e) {
      settled.current = false
      toastError(e)
    } finally {
      setSaving(false)
    }
  }
  if (draft === null)
    return (
      <span className="machine-name">
        <span className="machine-name__text">{machine.name}</span>
        <button
          type="button"
          className="machine-name__edit"
          aria-label={t('重命名#action')}
          title={t('重命名#action')}
          onClick={() => {
            settled.current = false
            setDraft(initial)
          }}
        >
          <Icon name="pencil" size={14} />
        </button>
      </span>
    )
  return (
    <TextField
      aria-label={t('名称')}
      className="machine-name__field"
      value={draft}
      placeholder={machine.hostname}
      maxLength={64}
      disabled={saving}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          void save(draft)
        } else if (e.key === 'Escape') {
          // Keeps a surrounding dialog open.
          e.preventDefault()
          settled.current = true
          setDraft(null)
        }
      }}
      onBlur={() => {
        if (settled.current) return
        const name = draft.trim()
        if (!name || name === initial) setDraft(null)
        else void save(name)
      }}
    />
  )
}

/** An offline machine's live sections: when it was last seen and how to bring it back; nothing is kept off it. */
function OfflineNote({ machine }: { machine: MachineDto }) {
  return (
    <section className="machine-offline" aria-label={t('机器离线')}>
      <span className="mx-strong">{t('机器离线')}</span>
      <span className="mx-sub">{t('最后在线：{time}', { time: dateText(machine.lastSeenAt) })}</span>
      <span>{t('供应商、Agent 工具与 Agent 设置只保存在机器上，机器上线后才能查看和修改。')}</span>
      <span>{t('让它上线：在该机器上打开共工空间客户端，或在终端运行')}</span>
      <CommandLine command="gg run" />
    </section>
  )
}

/** Sections of one machine, shared by its page and the admin dialog. */
export function MachineDetails({
  machine,
  ownerName,
  bots,
  onLeave,
}: {
  machine: MachineDto
  ownerName?: string
  /** Bots bound to this machine, when the caller has them. */
  bots?: BotDto[]
  /** Following a link out of the details. */
  onLeave?: () => void
}) {
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const v = params.get('tab') ?? ''
    return (Object.hasOwn(TAB_ALIAS, v) && TAB_ALIAS[v]) || 'overview'
  })
  const owner = useSession((st) => st.user?.id === machine.ownerId)
  const latest = useGet<ClientDownloads | null>('/client-downloads').data?.version
  const current = owner ? tab : 'overview'
  const specs: [IconName, string, string | null][] = [
    ['cpu', 'CPU', cpuText(machine)],
    ['activity', t('内存'), memoryText(machine.system?.memoryBytes)],
    ['terminal', t('内核'), machine.system?.kernel ?? null],
    ['wifi', t('MAC 地址'), machine.system?.macAddress ?? null],
  ]
  return (
    <>
      {owner ? (
        <div className="machine__tabs">
          <Tabs<Tab>
            aria-label={t('机器详情')}
            value={tab}
            onChange={setTab}
            items={[
              { value: 'overview', label: t('概览') },
              { value: 'agents', label: t('Agent 与供应商'), disabled: blocked(machine, 'agents') },
              { value: 'workspaces', label: t('工作区#tab'), disabled: blocked(machine, 'workspaces') },
              { value: 'diagnostics', label: t('诊断'), disabled: blocked(machine, 'diagnostics') },
            ]}
          />
          {blockedNote(machine) ? <p className="machine__tabs-note">{blockedNote(machine)}</p> : null}
        </div>
      ) : null}
      {current === 'overview' ? null : !machine.online ? (
        <OfflineNote machine={machine} />
      ) : blocked(machine, current) ? (
        <EmptyState
          compact
          title={t('请先升级该机器的 daemon')}
          description={t('当前 daemon 版本不支持在 Web 上管理，升级后即可使用。')}
        />
      ) : current === 'agents' ? (
        <AgentsPanel machine={machine} />
      ) : current === 'workspaces' ? (
        <WorkspacesPanel machine={machine} />
      ) : (
        <DiagnosticsPanel machine={machine} latest={latest} />
      )}
      {current === 'overview' ? (
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
                {upgradable(machine, latest) ? (
                  <span
                    className="machine__tag machine__tag--update"
                    title={t('daemon 会自动升级到最新版本')}
                  >
                    {t('可升级到 {version}', { version: latest })}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="machine__status" data-online={machine.online}>
              {machine.online ? t('在线') : t('离线')}
            </span>
          </section>
          {upgradable(machine, latest) ? (
            <Disclosure title={t('如何升级')}>
              <UpgradeGuide latest={latest} />
            </Disclosure>
          ) : null}
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
                    {a.available ? (a.version ?? t('已安装')) : t('未安装')}
                  </span>
                </span>
              ))
            ) : (
              <span className="machine__muted">{t('未检测到 Agent')}</span>
            )}
          </section>
          {bots?.length ? (
            <section className="machine__card">
              <span className="machine__card-title">{t('运行的 Bot')}</span>
              <ul className="machine__bots" aria-label={t('运行的 Bot')}>
                {bots.map((b) => (
                  <li key={b.id}>
                    <Link to={`/bot/${b.id}`} className="machine__bot" onClick={onLeave}>
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
                <dt>{t('主人')}</dt>
                <dd>{ownerName}</dd>
              </>
            ) : null}
            {machine.online ? null : (
              <>
                <dt>{t('最后在线')}</dt>
                <dd>{dateText(machine.lastSeenAt)}</dd>
              </>
            )}
            <dt>{t('首次绑定')}</dt>
            <dd>{dateText(machine.createdAt)}</dd>
            <dt>{t('最近绑定')}</dt>
            <dd>{dateText(machine.boundAt)}</dd>
          </dl>
        </div>
      ) : null}
    </>
  )
}
