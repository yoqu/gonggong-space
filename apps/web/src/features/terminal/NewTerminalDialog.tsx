import { TERMINAL_DIR_FEATURE, TERMINAL_SPACE_NAME_MAX } from '@gonggong/protocol'
import { type ReactNode, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, Dialog, GroupBox, Input, Select } from '../../ui'
import { DirPicker } from '../workspaces/DirPicker'
import { createTerminalSpace, machineSupportsTerminal } from './spaces'
import './terminal.css'

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? ''

/** Stateful draft for creating a terminal space; shared so tab switches inside NewGroupDialog preserve input. */
export function useTerminalForm({ machine, onClose }: { machine?: string; onClose: () => void }) {
  const me = useSession((s) => s.user?.id)
  const navigate = useNavigate()
  const machines = useWorkspace((s) => s.machines)
  const usable = machines.filter((m) => m.ownerId === me && machineSupportsTerminal(m, TERMINAL_DIR_FEATURE))
  const [machineId, setMachineId] = useState<string | null>(
    machine ?? (usable.length === 1 ? (usable[0]?.id ?? null) : null),
  )
  const effectiveMachineId = machineId ?? (usable.length === 1 ? (usable[0]?.id ?? null) : null)
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [named, setNamed] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [creating, setCreating] = useState(false)
  const setDir = (path: string) => {
    setCwd(path)
    if (!named) setName(baseName(path))
  }
  const missingReason = !usable.length
    ? t('没有可用的电脑')
    : !effectiveMachineId
      ? t('请选择一台电脑')
      : !cwd.trim().startsWith('/')
        ? t('请填写以 / 开头的目录路径')
        : !name.trim()
          ? t('请填写终端名称')
          : ''
  const ready = !missingReason && !creating
  const submit = async () => {
    if (!effectiveMachineId || !ready) return
    setCreating(true)
    try {
      const space = await createTerminalSpace({
        machineId: effectiveMachineId,
        cwd: cwd.trim(),
        name: name.trim(),
      })
      onClose()
      navigate(`/t/${space.id}`)
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }
  return {
    usable,
    machineId: effectiveMachineId,
    setMachineId,
    cwd,
    setDir,
    name,
    setName,
    setNamed,
    browsing,
    setBrowsing,
    creating,
    ready,
    missingReason,
    submit,
  }
}

export type TerminalForm = ReturnType<typeof useTerminalForm>

export function TerminalFormBody({ form }: { form: TerminalForm }) {
  return (
    <>
      {form.usable.length ? (
        <>
          <section className="nt-section">
            <h3 className="nt-section__title">{t('电脑')}</h3>
            <Select
              label={t('电脑')}
              options={form.usable.map((m) => ({ value: m.id, label: m.name }))}
              value={form.machineId}
              onChange={form.setMachineId}
            />
          </section>
          <section className="nt-section">
            <h3 className="nt-section__title">{t('目录')}</h3>
            <GroupBox>
              <div className="nt-field nt-dir">
                <Input
                  mono
                  aria-label={t('目录')}
                  value={form.cwd}
                  placeholder="/Users/me/code/project"
                  onChange={(e) => form.setDir(e.target.value)}
                />
                <Button size="small" disabled={!form.machineId} onClick={() => form.setBrowsing(true)}>
                  {t('浏览…')}
                </Button>
              </div>
            </GroupBox>
          </section>
          <section className="nt-section">
            <h3 className="nt-section__title">{t('名称')}</h3>
            <GroupBox>
              <div className="nt-field">
                <Input
                  aria-label={t('名称')}
                  value={form.name}
                  maxLength={TERMINAL_SPACE_NAME_MAX}
                  onChange={(e) => {
                    form.setNamed(true)
                    form.setName(e.target.value)
                  }}
                />
              </div>
            </GroupBox>
          </section>
          <p className="nt-hint">
            {t('终端会作为一个会话出现在左侧，只有你能打开；Shell 闲置 24 小时后结束，再次打开会新开一个。')}
          </p>
        </>
      ) : (
        <p className="nt-hint">
          {t('没有可用的电脑：需要你的一台在线的 macOS 或 Linux 电脑，且共工客户端已升级到最新版本。')}
        </p>
      )}
      {form.browsing && form.machineId ? (
        <DirPicker
          machineId={form.machineId}
          title={t('选择终端目录')}
          start={form.cwd.trim() || null}
          managed
          onPick={(path) => {
            form.setDir(path)
            form.setBrowsing(false)
          }}
          onClose={() => form.setBrowsing(false)}
        />
      ) : null}
    </>
  )
}

/** 新建终端: a directory on one of my machines, kept in the conversation list with nothing but its terminal. */
export function NewTerminalDialog({
  tabs,
  machine,
  onClose,
}: {
  tabs?: ReactNode
  /** Preselected, as from the machine's own page. */
  machine?: string
  onClose: () => void
}) {
  const form = useTerminalForm({ machine, onClose })
  const reasonId = useId()
  return (
    <Dialog
      open
      width={520}
      closeOnBackdrop={false}
      title={t('新建终端')}
      onClose={() => {
        if (!form.creating) onClose()
      }}
      footer={
        <>
          <span id={reasonId} className="ng-foot" aria-live="polite">
            {form.missingReason}
          </span>
          <Button disabled={form.creating} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            variant="primary"
            disabled={!form.ready}
            loading={form.creating}
            aria-describedby={form.missingReason ? reasonId : undefined}
            onClick={() => void form.submit()}
          >
            {t('创建')}
          </Button>
        </>
      }
    >
      <div className="nt-form">
        {tabs}
        <TerminalFormBody form={form} />
      </div>
    </Dialog>
  )
}
