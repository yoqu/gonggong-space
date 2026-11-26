import type { NewWorkRes } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { toast } from '../../ui'
import { lastWorkBot, rememberCanvasBot, useArtifactBots } from '../artifacts/CanvasBotPicker'

/** 新建: an empty work opens on its canvas straight away; the AI is picked under the canvas's input (last pick first). */
export function useNewWork(onCreated: () => void) {
  const navigate = useNavigate()
  const options = useArtifactBots()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    const last = lastWorkBot()
    const botId = (options.find((b) => b.id === last) ?? options[0])?.id
    if (!botId) return toast({ type: 'error', message: t('团队里还没有共字君或姜维川的 Claude Code') })
    setBusy(true)
    let res: NewWorkRes
    try {
      res = await api.post<NewWorkRes>('/works', { botId })
    } catch (e) {
      return toastError(e)
    } finally {
      setBusy(false)
    }
    rememberCanvasBot(res.artifactId, botId)
    onCreated()
    navigate(`/works/${res.artifactId}`)
  }
  return { busy, create }
}
