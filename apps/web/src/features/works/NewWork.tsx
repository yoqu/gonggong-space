import type { NewWorkRes } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { toast } from '../../ui'
import { lastWorkBot, pickDefaultBot, rememberCanvasBot, useArtifactBots } from '../artifacts/CanvasBotPicker'

/** 新建: an empty work opens on its canvas straight away; the Bot is picked under the canvas's input (last pick first). */
export function useNewWork(onCreated: () => Promise<unknown>) {
  const navigate = useNavigate()
  const options = useArtifactBots()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    const botId = pickDefaultBot(options, lastWorkBot())?.id
    if (!botId) return toast({ type: 'error', message: t('当前团队暂无可用于创作作品的 Bot') })
    setBusy(true)
    let res: NewWorkRes
    try {
      res = await api.post<NewWorkRes>('/works', { botId })
      rememberCanvasBot(res.artifactId, botId)
      await onCreated()
    } catch (e) {
      return toastError(e)
    } finally {
      setBusy(false)
    }
    navigate(`/works/${res.artifactId}`)
  }
  return { busy, create }
}
