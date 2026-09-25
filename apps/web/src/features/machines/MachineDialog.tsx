import type { MachineDto } from '@gonggong/protocol'
import { useId, useState } from 'react'
import { api } from '../../lib/api'
import { Button, Dialog, Divider, Form, FormRow, Presence, TextField, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { AGENT_LABEL, OS_LABEL } from './BindMachineDialog'
import { RevokeMachineDialog } from './RevokeMachineDialog'

const GB = 1024 ** 3

export const osText = (m: MachineDto) => m.system?.osVersion ?? OS_LABEL[m.os]
const memoryText = (bytes: number | null | undefined) => (bytes ? `${Math.round(bytes / GB)} GB` : null)
const cpuText = (m: MachineDto) =>
  [m.system?.cpuModel, m.system?.cpuCores && `${m.system.cpuCores} 核`].filter(Boolean).join(' · ') || null
export const hardwareText = (m: MachineDto) =>
  [cpuText(m), memoryText(m.system?.memoryBytes)].filter(Boolean).join(' · ') || null
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '--')

/** Details of one machine; its owner or a sysadmin can rename or revoke it. */
export function MachineDialog({
  machine,
  ownerName,
  onChanged,
  onClose,
}: {
  machine: MachineDto
  ownerName?: string
  /** Rename or revoke done: machine events reach only the owner, so a sysadmin's list must reload itself. */
  onChanged?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(machine.name === machine.hostname ? '' : machine.name)
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const formId = useId()
  const save = async () => {
    setSaving(true)
    try {
      const m = await api.patch<MachineDto>(`/machines/${machine.id}`, { name: name.trim() })
      toast({ type: 'success', message: `已重命名为 ${m.name}` })
      onChanged?.()
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setSaving(false)
    }
  }
  const rows: [string, string | null][] = [
    ['主人', ownerName ?? null],
    ['状态', machine.online ? '在线' : `离线 · 最后在线 ${dateText(machine.lastSeenAt)}`],
    ['主机名', machine.hostname],
    ['系统', osText(machine)],
    ['内核', machine.system?.kernel ?? null],
    ['架构', machine.arch],
    ['CPU', cpuText(machine)],
    ['内存', memoryText(machine.system?.memoryBytes)],
    ['MAC 地址', machine.system?.macAddress ?? null],
    ['daemon', machine.daemonVersion ? `v${machine.daemonVersion}` : null],
    ['首次绑定', dateText(machine.createdAt)],
    ['最近绑定', dateText(machine.boundAt)],
  ]
  return (
    <>
      <Dialog
        open={!revoking}
        title="机器详情"
        message={machine.name}
        width={520}
        onClose={onClose}
        footer={
          <Button variant="plain" className="machine__revoke" onClick={() => setRevoking(true)}>
            吊销机器
          </Button>
        }
        actions={[{ label: '完成', variant: 'primary', onClick: onClose }]}
      >
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
          <Divider />
          {rows
            .filter((r): r is [string, string] => r[1] !== null)
            .map(([k, v]) => (
              <FormRow key={k} label={k}>
                <span className="machine__value">{v}</span>
              </FormRow>
            ))}
          <FormRow label="Agent" align="top">
            <span className="machine__value">
              {machine.agents.length
                ? machine.agents.map((a) => (
                    <span key={a.kind}>
                      {`${AGENT_LABEL[a.kind]} ${a.available ? (a.version ?? '') : '未安装'}`.trim()}
                    </span>
                  ))
                : '--'}
            </span>
          </FormRow>
        </Form>
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
