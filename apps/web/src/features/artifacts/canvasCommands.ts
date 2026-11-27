import type { ArtifactDevice, ArtifactPluginCommandDto, GgArtifactRef } from '@gonggong/protocol'
import { t } from '../../i18n'
import { type CommandEntry, entriesOf } from './CommandMenu'
import { LINK_CMD } from './canvasLinks'
import type { Tool } from './canvasTopbar'
import { type CanvasNode, linkNodeId, refNodeId, type ScreenFrame } from './geometry'
import {
  type BotState,
  CMD,
  copyPngItem,
  generateItems,
  modifyItems,
  moreItems,
  previewItems,
  variationItems,
  ZOOM_SELECTION,
  zoomItems,
} from './menus'

const TOOL_IDS: Exclude<Tool, 'hotspot'>[] = ['select', 'mark', 'edit', 'play', 'hand']
/** Command-menu values beyond the menus' own commands. */
export const RUN = { tool: 'tool:', zoom: 'zoom:', screen: 'screen:', panel: 'panel:' } as const
/** Commands that take selected references as well as screens. */
const REF_COMMANDS: string[] = [CMD.addToChat, CMD.remove, CMD.rename, CMD.download]

/** Commands about the selected screens: the command menu greys them out with nothing selected. */
export const needsSelection = (v: string) =>
  v.startsWith(CMD.generate) ||
  v.startsWith(CMD.variations) ||
  v.startsWith(CMD.frame) ||
  (
    [
      CMD.edit,
      CMD.details,
      CMD.code,
      CMD.download,
      CMD.reload,
      CMD.remove,
      CMD.copy,
      CMD.copyCode,
      CMD.copyPng,
      CMD.cut,
      CMD.duplicate,
      CMD.focus,
      CMD.favourite,
      CMD.rename,
      CMD.addToChat,
      CMD.newTab,
      CMD.fullHeight,
      `${RUN.zoom}${ZOOM_SELECTION}`,
    ] as string[]
  ).includes(v)

/** Everything the canvas's ⌘K menu lists: screens, references, links, then each menu's commands. */
export function canvasCommandEntries(o: {
  picked: CanvasNode[]
  pickedRefs: GgArtifactRef[]
  one: CanvasNode | undefined
  preview: unknown
  screens: CanvasNode[]
  refs: GgArtifactRef[]
  links: { id: string; title: string }[]
  canEdit: boolean
  clip: unknown
  hasThumb: boolean
  botState: BotState
  pluginCommands: ArtifactPluginCommandDto[]
  sharedFrame: ScreenFrame | null
  device: ArtifactDevice
  selected: string[]
  noEditReason: string | undefined
  designMd: string | null | undefined
}): CommandEntry[] {
  const { picked, pickedRefs, one, preview, screens, refs, links, canEdit, clip, hasThumb } = o
  const { botState, pluginCommands, sharedFrame, device, selected, noEditReason, designMd } = o
  const none = { disabled: true, title: t('先选中屏幕') }
  const gate = (e: CommandEntry): CommandEntry =>
    !picked.length && needsSelection(e.value) && !(pickedRefs.length && REF_COMMANDS.includes(e.value))
      ? { ...e, ...none }
      : e
  const single = !!one && !!preview
  const all: CommandEntry[] = [
    ...screens.map((n) => ({ group: t('屏幕'), label: n.title, value: `${RUN.screen}${n.id}` })),
    ...refs.map((r) => ({
      group: t('参考文件'),
      label: r.title,
      value: `${RUN.screen}${refNodeId(r.id)}`,
    })),
    ...links.map((l) => ({
      group: t('链接'),
      label: l.title,
      value: `${RUN.screen}${linkNodeId(l.id)}`,
    })),
    ...entriesOf(t('选择'), [
      { label: t('全选'), value: CMD.selectAll, shortcut: '⌘A' },
      { label: t('添加到对话'), value: CMD.addToChat, shortcut: '⌘L' },
      { label: t('复制'), value: CMD.copy, shortcut: '⌘C' },
      { label: t('复制代码'), value: CMD.copyCode },
      { label: t('复制选区链接'), value: CMD.copyLink },
      copyPngItem(hasThumb),
      { label: t('剪切'), value: CMD.cut, shortcut: '⌘X', disabled: !canEdit },
      { label: t('粘贴'), value: CMD.paste, shortcut: '⌘V', disabled: !canEdit || !clip },
      { label: t('创建副本'), value: CMD.duplicate, shortcut: '⌘D', disabled: !canEdit },
      { label: t('聚焦'), value: CMD.focus, shortcut: 'F' },
      { label: t('收藏'), value: CMD.favourite, shortcut: '⇧F' },
      { label: t('重命名'), value: CMD.rename, disabled: !canEdit || (!one && pickedRefs.length !== 1) },
      { label: t('删除'), value: CMD.remove, shortcut: '⌫', disabled: !canEdit },
    ]),
    ...entriesOf(t('生成'), generateItems(botState, pluginCommands)),
    ...entriesOf(t('生成'), variationItems(botState), `${t('变体')} › `),
    ...entriesOf(t('修改#modify'), modifyItems(!canEdit)),
    ...entriesOf(t('预览'), previewItems(single, sharedFrame, device)),
    ...entriesOf(t('更多'), moreItems(!canEdit)),
    ...entriesOf(
      t('视图'),
      zoomItems(selected.length > 0).map((it) =>
        'value' in it ? { ...it, value: `${RUN.zoom}${it.value}` } : it,
      ),
    ),
    ...entriesOf(t('视图'), [{ label: t('显示连线'), value: CMD.links, shortcut: 'X' }]),
    ...entriesOf(
      t('工具'),
      TOOL_IDS.map((id) => ({
        label: {
          select: t('选择'),
          mark: t('标记#mark'),
          edit: t('直接编辑'),
          play: t('交互'),
          hand: t('抓手'),
        }[id],
        value: `${RUN.tool}${id}`,
        shortcut: { select: 'V', mark: 'M', edit: 'E', play: 'P', hand: 'H' }[id],
        ...(id === 'edit' && noEditReason ? { disabled: true, title: noEditReason } : {}),
      })),
    ),
    ...entriesOf(t('工具'), [
      {
        label: t('上传到画布'),
        value: CMD.upload,
        ...(noEditReason ? { disabled: true, title: noEditReason } : {}),
      },
      {
        label: t('添加链接'),
        value: LINK_CMD.add,
        ...(noEditReason ? { disabled: true, title: noEditReason } : {}),
      },
    ]),
    ...entriesOf(t('面板'), [
      { label: t('设计系统'), value: CMD.designSystem },
      ...(designMd ? [{ label: 'DESIGN.md', value: CMD.designMd }] : []),
      { label: t('收藏'), value: `${RUN.panel}favourites` },
      { label: t('批注'), value: `${RUN.panel}annotations` },
      { label: t('页面规则'), value: CMD.rules },
      { label: t('共享规则.md'), value: CMD.sharedRules },
      { label: t('快捷键'), value: CMD.shortcuts, shortcut: '?' },
    ]),
  ]
  return all.map(gate)
}
