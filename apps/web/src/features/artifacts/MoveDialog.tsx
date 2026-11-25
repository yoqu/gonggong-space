import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkbench } from '../../app/workbench'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Dialog, Select, toast } from '../../ui'
import { useArtifactPage } from './host'
import { loadArtifact, moveArtifact } from './store'

/** 移动到群…: picks another group the caller is in; the artifact goes there with its versions and share link. */
export function MoveDialog({
  artifact,
  tabKey,
  onClose,
}: {
  artifact: { id: string; title: string; groupId: string }
  tabKey: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const page = useArtifactPage()
  const groups = useWorkspace((s) => s.groups)
  const options = groups
    .filter((g) => g.kind === 'group' && g.id !== artifact.groupId)
    .map((g) => ({ value: g.id, label: g.name }))
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const move = async () => {
    if (!target) return
    setBusy(true)
    try {
      await moveArtifact(artifact.id, target)
      const name = options.find((o) => o.value === target)?.label ?? ''
      toast({ type: 'success', message: t('已移到群「{group}」', { group: name }) })
      if (page) {
        await loadArtifact(artifact.id)
        onClose()
        return
      }
      useWorkbench.getState().closeTab(tabKey)
      navigate(`/g/${target}`)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('移动「{title}」到群', { title: artifact.title })}
      message={t('版本历史和分享链接都会保留；原群会收到一条移动通知')}
      onClose={onClose}
      closeOnScrim={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('移动'), variant: 'primary', disabled: !target || busy, onClick: () => void move() },
      ]}
    >
      {options.length ? (
        <Select
          label={t('目标群')}
          options={options}
          value={target}
          onChange={setTarget}
          placeholder={t('选择群')}
        />
      ) : (
        <p>{t('你没有其他可移入的群')}</p>
      )}
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}
