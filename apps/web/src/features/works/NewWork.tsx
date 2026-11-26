import type { NewWorkRes } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Dialog, Select } from '../../ui'
import { rememberCanvasBot, useArtifactBots } from '../artifacts/CanvasBotPicker'

const LAST = 'gg.works.newBot'

/** 新建: only pick the AI, no group. An empty work opens in its editor, made in 画布 AI 对话 with that AI. */
export function NewWorkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate()
  const options = useArtifactBots()
  const last = localStorage.getItem(LAST)
  const [botId, setBotId] = useState<string | null>(
    options.find((b) => b.id === last)?.id ?? options[0]?.id ?? null,
  )
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!botId) return
    setBusy(true)
    let res: NewWorkRes
    try {
      res = await api.post<NewWorkRes>('/works', { botId })
    } catch (e) {
      setBusy(false)
      return toastError(e)
    }
    localStorage.setItem(LAST, botId)
    rememberCanvasBot(res.artifactId, botId)
    onClose()
    onCreated()
    navigate(`/works/${res.artifactId}`)
  }
  return (
    <Dialog
      open
      title={t('新建作品')}
      message={t('选一个 AI，在画布左侧的 AI 对话里说要做什么，它做出第一版后继续对话修改')}
      width={440}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('下一步'), variant: 'primary', disabled: !botId || busy, onClick: () => void go() },
      ]}
    >
      {options.length ? (
        <Select
          label={t('交给谁')}
          options={options.map((b) => ({ value: b.id, label: b.name }))}
          value={botId}
          onChange={setBotId}
        />
      ) : (
        <div className="gs-note">{t('团队里还没有共字君或姜维川的 Claude Code')}</div>
      )}
    </Dialog>
  )
}
