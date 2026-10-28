import { TERMINAL_DIR_FEATURE, TERMINAL_SPACE_NAME_MAX } from '@gonggong/protocol'
import { type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, Dialog, GroupBox, Input, Select } from '../../ui'
import { DirPicker } from '../workspaces/DirPicker'
import { createTerminalSpace } from './spaces'

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? ''

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
  const me = useSession((s) => s.user?.id)
  const navigate = useNavigate()
  const machines = useWorkspace((s) => s.machines)
  const usable = machines.filter(
    (m) =>
      m.ownerId === me &&
      m.online &&
      (m.os === 'macos' || m.os === 'linux') &&
      m.features.includes(TERMINAL_DIR_FEATURE),
  )
  const [machineId, setMachineId] = useState<string | null>(
    machine ?? (usable.length === 1 ? (usable[0]?.id ?? null) : null),
  )
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [named, setNamed] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [creating, setCreating] = useState(false)
  const setDir = (path: string) => {
    setCwd(path)
    if (!named) setName(baseName(path))
  }
  const ready = !!machineId && cwd.trim().startsWith('/') && !!name.trim() && !creating
  const submit = async () => {
    if (!machineId) return
    setCreating(true)
    try {
      const space = await createTerminalSpace({ machineId, cwd: cwd.trim(), name: name.trim() })
      onClose()
      navigate(`/t/${space.id}`)
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }
  return (
    <>
      <Dialog
        open
        width={520}
        closeOnBackdrop={false}
        title={t('新建终端')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('取消')}</Button>
            <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
              {t('创建')}
            </Button>
          </>
        }
      >
        <div className="ng">
          {tabs}
          {usable.length ? (
            <>
              <section className="ng-section">
                <h3 className="ng-section__title">{t('机器')}</h3>
                <Select
                  label={t('机器')}
                  options={usable.map((m) => ({ value: m.id, label: m.name }))}
                  value={machineId}
                  onChange={setMachineId}
                />
              </section>
              <section className="ng-section">
                <h3 className="ng-section__title">{t('目录')}</h3>
                <GroupBox>
                  <div className="ng-name ng-dir">
                    <Input
                      mono
                      aria-label={t('目录')}
                      value={cwd}
                      placeholder="/Users/me/code/project"
                      onChange={(e) => setDir(e.target.value)}
                    />
                    <Button size="small" disabled={!machineId} onClick={() => setBrowsing(true)}>
                      {t('浏览…')}
                    </Button>
                  </div>
                </GroupBox>
              </section>
              <section className="ng-section">
                <h3 className="ng-section__title">{t('名称')}</h3>
                <GroupBox>
                  <div className="ng-name">
                    <Input
                      aria-label={t('名称')}
                      value={name}
                      maxLength={TERMINAL_SPACE_NAME_MAX}
                      onChange={(e) => {
                        setNamed(true)
                        setName(e.target.value)
                      }}
                    />
                  </div>
                </GroupBox>
              </section>
              <p className="ng-hint">
                {t(
                  '终端会作为一个会话出现在左侧，只有你能打开；Shell 闲置 24 小时后结束，再次打开会新开一个。',
                )}
              </p>
            </>
          ) : (
            <p className="ng-hint">
              {t('没有可用的机器：需要你的一台在线的 macOS 或 Linux 机器，且客户端已升级到最新版本。')}
            </p>
          )}
        </div>
      </Dialog>
      {browsing && machineId ? (
        <DirPicker
          machineId={machineId}
          title={t('选择终端目录')}
          start={cwd.trim() || null}
          onPick={(path) => {
            setDir(path)
            setBrowsing(false)
          }}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
    </>
  )
}
