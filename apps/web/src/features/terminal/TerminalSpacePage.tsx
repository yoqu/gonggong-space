import { TERMINAL_SPACE_NAME_MAX, type TerminalSpaceDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, ChatHeader, Dialog, Icon, Input, Presence } from '../../ui'
import { deleteTerminalSpace, renameTerminalSpace, touchTerminalSpace } from './spaces'
import { TerminalView } from './TerminalView'
import './terminal.css'

/** A machine terminal as a conversation: only its terminal, plus rename, a fresh shell after one ends, and delete. */
export function TerminalSpacePage({ space, onBack }: { space: TerminalSpaceDto; onBack?: () => void }) {
  const navigate = useNavigate()
  // A new generation remounts the view, which opens a new shell once the last one has ended.
  const [generation, setGeneration] = useState(0)
  const [ended, setEnded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingBusy, setDeletingBusy] = useState(false)
  useEffect(() => touchTerminalSpace(space.id), [space.id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per-space UI state when switching terminal spaces
  useEffect(() => {
    setEnded(false)
    setFailed(false)
    setRenaming(false)
    setDeleting(false)
    setDeletingBusy(false)
  }, [space.id])
  const restart = () => {
    setEnded(false)
    setFailed(false)
    setGeneration((g) => g + 1)
  }
  const remove = async () => {
    if (deletingBusy) return
    setDeletingBusy(true)
    try {
      await deleteTerminalSpace(space.id)
      navigate('/', { replace: true })
    } catch (e) {
      toastError(e)
      setDeletingBusy(false)
    }
  }
  return (
    <section className="terminal-space" aria-label={t('终端会话')}>
      <ChatHeader
        avatar={
          <span className="terminal-space__avatar">
            <Icon name="terminal" size={18} />
          </span>
        }
        title={space.name}
        subtitle={`${space.machineName} · ${space.cwd}`}
        onBack={onBack}
        actions={[
          {
            icon: 'arrow-clockwise',
            label: t('新开 Shell'),
            disabled: !ended && !failed,
            onClick: restart,
          },
          { icon: 'textformat', label: t('重命名'), onClick: () => setRenaming(true) },
          { icon: 'trash', label: t('删除终端'), onClick: () => setDeleting(true) },
        ]}
      />
      <div className="terminal-space__body">
        <TerminalView
          key={`${space.id}:${generation}`}
          spaceId={space.id}
          active
          onExit={() => setEnded(true)}
          onError={() => setFailed(true)}
          onRestart={restart}
        />
      </div>
      <Presence>
        {renaming ? <RenameDialog space={space} onClose={() => setRenaming(false)} /> : null}
      </Presence>
      <Presence>
        {deleting ? (
          <Dialog
            open
            role="alertdialog"
            title={t('删除终端「{name}」？', { name: space.name })}
            message={t('会结束其中的 Shell 及正在运行的进程，并从会话列表移除；电脑上的目录不受影响。')}
            onClose={() => {
              if (!deletingBusy) setDeleting(false)
            }}
            actions={[
              {
                label: t('取消'),
                disabled: deletingBusy,
                onClick: () => setDeleting(false),
                autoFocus: true,
              },
              {
                label: deletingBusy ? t('正在删除…') : t('删除'),
                variant: 'destructive',
                disabled: deletingBusy,
                onClick: () => void remove(),
              },
            ]}
          />
        ) : null}
      </Presence>
    </section>
  )
}

function RenameDialog({ space, onClose }: { space: TerminalSpaceDto; onClose: () => void }) {
  const [name, setName] = useState(space.name)
  const [saving, setSaving] = useState(false)
  const trimmed = name.trim()
  const canSave = !!trimmed && trimmed !== space.name && !saving
  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await renameTerminalSpace(space.id, trimmed)
      onClose()
    } catch (e) {
      toastError(e)
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      width={400}
      title={t('重命名终端')}
      onClose={() => {
        if (!saving) onClose()
      }}
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {saving ? t('保存中…') : t('保存')}
          </Button>
        </>
      }
    >
      <Input
        aria-label={t('名称')}
        value={name}
        maxLength={TERMINAL_SPACE_NAME_MAX}
        disabled={saving}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSave) void save()
        }}
      />
    </Dialog>
  )
}
