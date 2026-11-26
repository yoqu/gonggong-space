import { TERMINAL_SPACE_NAME_MAX, type TerminalSpaceDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, ChatHeader, ConfirmActionDialog, Dialog, Icon, Input, Presence } from '../../ui'
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
  useEffect(() => touchTerminalSpace(space.id), [space.id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per-space UI state when switching terminal spaces
  useEffect(() => {
    setEnded(false)
    setFailed(false)
    setRenaming(false)
    setDeleting(false)
  }, [space.id])
  const restart = () => {
    setEnded(false)
    setFailed(false)
    setGeneration((g) => g + 1)
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
          <ConfirmActionDialog
            title={t('要删除终端「{name}」吗？', { name: space.name })}
            message={t('会结束其中的 Shell 及正在运行的进程，并从会话列表移除；电脑上的目录不受影响。')}
            consequences={[]}
            label={t('删除')}
            done={t('终端已删除')}
            run={() => deleteTerminalSpace(space.id)}
            onDone={() => navigate('/', { replace: true })}
            onClose={() => setDeleting(false)}
          />
        ) : null}
      </Presence>
    </section>
  )
}

function RenameDialog({ space, onClose }: { space: TerminalSpaceDto; onClose: () => void }) {
  const [name, setName] = useState(space.name)
  const [saving, setSaving] = useState(false)
  const composingRef = useRef(false)
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
      closeOnBackdrop={false}
      title={t('重命名终端')}
      onClose={() => {
        if (!saving) onClose()
      }}
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button variant="primary" disabled={!canSave} loading={saving} onClick={() => void save()}>
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
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229 &&
            !composingRef.current &&
            canSave
          )
            void save()
        }}
      />
    </Dialog>
  )
}
