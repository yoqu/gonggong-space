import type { ArtifactCommand, ArtifactCommandReq } from '@gonggong/protocol'
import { t } from '../../i18n'
import type { CanvasContext } from './context'

/** The composer's `/` artifact commands (Stitch's `/` menu), mapped to POST …/commands. */
export interface ArtifactSlash {
  command: ArtifactCommand
  label: string
  hint: string
  /** Works on the selected screens: off until the canvas has some. */
  needsScreen: boolean
}

export const ARTIFACT_SLASH: ArtifactSlash[] = [
  { command: 'image', label: t('图片'), hint: t('绘制插图并用在选中的屏幕里'), needsScreen: false },
  { command: 'logo', label: 'Logo', hint: t('设计几个 logo 方案'), needsScreen: false },
  { command: 'diagram', label: t('图表'), hint: t('画图表或流程图，作为新屏'), needsScreen: false },
  { command: 'animate', label: t('动效'), hint: t('给选中的屏幕加入场动效'), needsScreen: true },
  {
    command: 'app-store-assets',
    label: t('应用商店素材'),
    hint: t('上架截图与应用图标'),
    needsScreen: false,
  },
  { command: 'web-assets', label: t('网页素材'), hint: t('横幅、分享图与 favicon'), needsScreen: false },
  { command: 'marketing-kit', label: t('营销物料'), hint: t('海报、社交配图与横幅'), needsScreen: false },
  {
    command: 'accessibility-audit',
    label: t('无障碍检查'),
    hint: t('检查并修复选中屏幕的无障碍问题'),
    needsScreen: true,
  },
]

/** The artifact command a draft starts with (`/Logo 极简风`), and the rest of it as the request. */
export function parseArtifactSlash(draft: string) {
  const s = draft.trimStart()
  if (!s.startsWith('/')) return null
  const hit = [...ARTIFACT_SLASH]
    .sort((a, b) => b.label.length - a.label.length)
    .find((c) => {
      const head = s.slice(1, 1 + c.label.length)
      const after = s[1 + c.label.length]
      return head.toLowerCase() === c.label.toLowerCase() && (after === undefined || /\s/.test(after))
    })
  return hit ? { slash: hit, text: s.slice(1 + hit.label.length).trim() } : null
}

/** What of the canvas selection a command is about: whole screens, and elements by their source position. */
export function commandSelection(c: CanvasContext | null): Pick<ArtifactCommandReq, 'screenIds' | 'ggIds'> {
  if (!c) return {}
  const screenIds = [...new Set(c.items.filter((i) => !i.element).map((i) => i.screenId))]
  const ggIds = c.items.flatMap((i) => (i.element ? [{ file: i.element.file, ggId: i.element.ggId }] : []))
  return { ...(screenIds.length ? { screenIds } : {}), ...(ggIds.length ? { ggIds } : {}) }
}

/** The screens a selection touches (an element's screen too): what variations are made of. */
export const selectedScreenIds = (c: CanvasContext | null) => [
  ...new Set((c?.items ?? []).map((i) => i.screenId)),
]
