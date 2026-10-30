import type { ArtifactDevice } from '@gonggong/protocol'
import { t } from '../../i18n'
import type { MenuItem } from '../../ui'
import { FRAME_PRESETS, type FramePreset, framePreset, type ScreenFrame } from './geometry'

/** Commands of the selection toolbar, the context menu and the keyboard. */
export const CMD = {
  newTab: 'new-tab',
  edit: 'edit',
  designSystem: 'design-system',
  details: 'details',
  code: 'code',
  download: 'download',
  reload: 'reload',
  remove: 'delete',
  copy: 'copy',
  /** Copy as › code: the screens' HTML to the system clipboard. */
  copyCode: 'copy-code',
  /** Copy as › link to selection: the page link opening the artifact on these screens. */
  copyLink: 'copy-link',
  /** Copy as › PNG (⌘⇧C): the screen's thumbnail as an image. */
  copyPng: 'copy-png',
  /** Upload to canvas (G04): pick files that become reference nodes. */
  upload: 'upload',
  cut: 'cut',
  paste: 'paste',
  duplicate: 'duplicate',
  focus: 'focus',
  favourite: 'favourite',
  rename: 'rename',
  links: 'links',
  selectAll: 'select-all',
  fit: 'fit',
  fullHeight: 'full-height',
  frame: 'frame:',
  addToChat: 'add-to-chat',
  qr: 'qr',
  export: 'export',
  /** The command menu (⌘K). */
  commands: 'commands',
  shortcuts: 'shortcuts',
  /** The DESIGN.md page of the design-system panel. */
  designMd: 'design-md',
  /** `gen:<ArtifactCommand>`: POST …/commands for the selected screens. */
  generate: 'gen:',
  /** `var:<dimension>`: variations along one dimension; `var:custom` asks for the direction. */
  variations: 'var:',
} as const

/** Variation dimensions (Stitch's Variations submenu); `ai` goes into the agent's instruction (never translated). */
export const VARIATION_DIMENSIONS: Record<string, { label: string; ai: string }> = {
  layout: { label: t('布局'), ai: '布局' },
  color: { label: t('配色'), ai: '配色' },
  images: { label: t('图片'), ai: '图片' },
  font: { label: t('字体'), ai: '字体' },
  copy: { label: t('文案'), ai: '文案' },
}
export const VARIATION_CUSTOM = 'custom'

/**
 * Who AI items go to: `none` without a bot in the group (they are off), else the offline hint while the bot's machine
 * is down (they still go, and wait for it: actions.ts `offlineHint`), else null.
 */
export type BotState = 'none' | string | null

const botTitle = (bot: BotState) =>
  bot === 'none' ? { disabled: true, title: t('群里没有 Bot') } : bot ? { title: bot } : {}
/** An offline bot heads the menu with the hint. */
const botHeader = (bot: BotState): MenuItem[] => (bot && bot !== 'none' ? [{ header: bot }] : [])
const gen = (label: string, command: string, bot: BotState, shortcut?: string): MenuItem => ({
  label,
  value: `${CMD.generate}${command}`,
  ...(shortcut ? { shortcut } : {}),
  ...botTitle(bot),
})

/** The selection toolbar's four menus (Stitch capability list §3, 选中屏幕); each item becomes an @bot message. */
export const generateItems = (bot: BotState): MenuItem[] => [
  ...botHeader(bot),
  gen(t('即时原型'), 'instant-prototype', bot),
  gen(t('变体'), 'variations', bot),
  gen(t('重新生成'), 'regenerate', bot, '⇧R'),
  gen(t('桌面网页版'), 'desktop-version', bot),
  gen(t('补全状态'), 'missing-states', bot),
  gen(t('动效'), 'animate', bot),
  { separator: true },
  gen(t('应用商店素材'), 'app-store-assets', bot),
  gen(t('网页素材'), 'web-assets', bot),
  gen(t('营销物料'), 'marketing-kit', bot),
  gen(t('无障碍检查'), 'accessibility-audit', bot),
]

export const variationItems = (bot: BotState): MenuItem[] => [
  ...botHeader(bot),
  ...Object.entries(VARIATION_DIMENSIONS).map(([k, d]) => ({
    label: d.label,
    value: `${CMD.variations}${k}`,
    ...botTitle(bot),
  })),
  {
    label: t('自定义…'),
    value: `${CMD.variations}${VARIATION_CUSTOM}`,
    shortcut: '⇧V',
    ...botTitle(bot),
  },
]

const readOnlyTitle = (readOnly: boolean) => (readOnly ? { disabled: true, title: t('AI 正在修改') } : {})

export const modifyItems = (readOnly: boolean): MenuItem[] => [
  { label: t('编辑'), value: CMD.edit, shortcut: 'E', ...readOnlyTitle(readOnly) },
  { label: t('设计系统'), value: CMD.designSystem },
]

const PRESET_NAME: Record<FramePreset, string> = {
  mobile: t('手机'),
  tablet: t('平板'),
  desktop: t('桌面'),
}

/** `frame`: the selected screens' framing when they share one; the phone preset is as wide as `device`'s phones. */
export const previewItems = (
  single: boolean,
  frame: ScreenFrame | null,
  device: ArtifactDevice,
): MenuItem[] => [
  {
    label: t('新标签页打开'),
    value: CMD.newTab,
    shortcut: '⇧P',
    disabled: !single,
    ...(single ? {} : { title: t('选中一个屏幕') }),
  },
  { label: t('显示二维码'), value: CMD.qr },
  { separator: true },
  ...(Object.keys(FRAME_PRESETS) as FramePreset[]).map((p) => {
    const { w, h } = framePreset(p, device)
    return { label: `${PRESET_NAME[p]} ${w}×${h}`, value: `${CMD.frame}${p}`, checked: frame?.w === w }
  }),
  { separator: true },
  { label: t('全高'), value: CMD.fullHeight, checked: !!frame?.full },
]

export const moreItems = (readOnly: boolean): MenuItem[] => [
  { label: t('查看详情'), value: CMD.details, shortcut: 'I' },
  { label: t('查看代码'), value: CMD.code, shortcut: '⇧C' },
  { label: t('导出'), value: CMD.export, shortcut: '⌘⇧E' },
  { label: t('下载'), value: CMD.download, shortcut: '⇧D' },
  { label: t('重新加载'), value: CMD.reload, shortcut: '⌘R' },
  { separator: true },
  { label: t('删除'), value: CMD.remove, shortcut: '⌫', destructive: true, ...readOnlyTitle(readOnly) },
]

/** Right-click on selected screens (Stitch capability list §3, 右键菜单). */
export function screenContextItems(o: {
  readOnly: boolean
  single: boolean
  canPaste: boolean
  favourite: boolean
  showAllLinks: boolean
  frame: ScreenFrame | null
  bot: BotState
  device: ArtifactDevice
  /** The one selected screen has a thumbnail to copy as PNG. */
  png: boolean
}): MenuItem[] {
  const ro = readOnlyTitle(o.readOnly)
  return [
    { label: t('添加到对话'), value: CMD.addToChat, shortcut: '⌘L' },
    { label: t('复制'), value: CMD.copy, shortcut: '⌘C' },
    {
      label: t('复制为'),
      value: 'copy-as',
      submenu: [
        { label: t('复制代码'), value: CMD.copyCode },
        { label: t('复制选区链接'), value: CMD.copyLink },
        copyPngItem(o.png),
      ],
    },
    { label: t('剪切'), value: CMD.cut, shortcut: '⌘X', ...ro },
    { label: t('粘贴'), value: CMD.paste, shortcut: '⌘V', disabled: o.readOnly || !o.canPaste },
    { label: t('创建副本'), value: CMD.duplicate, shortcut: '⌘D', ...ro },
    { label: t('聚焦'), value: CMD.focus, shortcut: 'F' },
    { label: t('收藏'), value: CMD.favourite, shortcut: '⇧F', checked: o.favourite },
    { separator: true },
    { label: t('重命名'), value: CMD.rename, disabled: o.readOnly || !o.single },
    { label: t('删除'), value: CMD.remove, shortcut: '⌫', destructive: true, ...ro },
    { separator: true },
    { header: t('生成') },
    { label: t('生成'), value: 'generate', submenu: generateItems(o.bot) },
    { label: t('变体'), value: 'variations', submenu: variationItems(o.bot) },
    gen(t('重新生成'), 'regenerate', o.bot, '⇧R'),
    { separator: true },
    { header: t('编辑') },
    ...modifyItems(o.readOnly),
    { separator: true },
    { header: t('预览') },
    ...previewItems(o.single, o.frame, o.device).filter((it) => !('separator' in it)),
    { separator: true },
    { label: t('显示连线'), value: CMD.links, shortcut: 'X', checked: o.showAllLinks },
    ...moreItems(o.readOnly).filter((it) => 'value' in it && it.value !== CMD.remove && it.disabled !== true),
  ]
}

/** Copy as › PNG: off (with the reason) until the server has the screen's thumbnail. */
export const copyPngItem = (png: boolean): MenuItem => ({
  label: t('复制为 PNG'),
  value: CMD.copyPng,
  shortcut: '⌘⇧C',
  ...(png ? {} : { disabled: true, title: t('缩略图生成后才能复制为 PNG') }),
})

/** Right-click on selected references (G04). */
export const refContextItems = (o: { readOnly: boolean; single: boolean }): MenuItem[] => {
  const ro = readOnlyTitle(o.readOnly)
  return [
    { label: t('添加到对话'), value: CMD.addToChat, shortcut: '⌘L' },
    { label: t('下载'), value: CMD.download, shortcut: '⇧D' },
    { separator: true },
    { label: t('重命名'), value: CMD.rename, disabled: o.readOnly || !o.single },
    { label: t('删除'), value: CMD.remove, shortcut: '⌫', destructive: true, ...ro },
  ]
}

/** Right-click on the empty canvas. */
export const canvasContextItems = (o: {
  readOnly: boolean
  canPaste: boolean
  showAllLinks: boolean
}): MenuItem[] => [
  { label: t('粘贴'), value: CMD.paste, shortcut: '⌘V', disabled: o.readOnly || !o.canPaste },
  { label: t('全选'), value: CMD.selectAll, shortcut: '⌘A' },
  { separator: true },
  { label: t('显示连线'), value: CMD.links, shortcut: 'X', checked: o.showAllLinks },
  { label: t('适应画布'), value: CMD.fit, shortcut: '⇧1' },
  { separator: true },
  { label: t('上传到画布'), value: CMD.upload, ...readOnlyTitle(o.readOnly) },
  { label: t('设计系统'), value: CMD.designSystem },
]

export const ZOOM_IN = 'in'
export const ZOOM_OUT = 'out'
export const ZOOM_100 = '100'
export const ZOOM_FIT = 'fit'
export const ZOOM_SELECTION = 'selection'
export const zoomItems = (hasSelection: boolean): MenuItem[] => [
  { label: t('放大'), value: ZOOM_IN, shortcut: '⌘+' },
  { label: t('缩小'), value: ZOOM_OUT, shortcut: '⌘-' },
  { separator: true },
  { label: t('缩放到 100%'), value: ZOOM_100, shortcut: '⇧0' },
  { label: t('适应画布'), value: ZOOM_FIT, shortcut: '⇧1' },
  { label: t('适应选中'), value: ZOOM_SELECTION, shortcut: '⇧2', disabled: !hasSelection },
]

/** The shortcut sheet (Stitch capability list §9); `soon` ones are listed but not wired yet. ⌘S is left out: every
 * change is a version at once, nothing waits to be saved. */
export const SHORTCUTS: { title: string; items: { label: string; keys: string[]; soon?: boolean }[] }[] = [
  {
    title: t('通用'),
    items: [
      { label: t('快捷键'), keys: ['?'] },
      { label: t('命令菜单'), keys: ['⌘', 'K'] },
    ],
  },
  {
    title: t('编辑'),
    items: [
      { label: t('撤销#undo'), keys: ['⌘', 'Z'] },
      { label: t('重做'), keys: ['⌘', '⇧', 'Z'] },
      { label: t('全选'), keys: ['⌘', 'A'] },
      { label: t('取消选择'), keys: ['Esc'] },
      { label: t('剪切'), keys: ['⌘', 'X'] },
      { label: t('复制（含代码）'), keys: ['⌘', 'C'] },
      { label: t('复制为 PNG'), keys: ['⌘', '⇧', 'C'] },
      { label: t('粘贴'), keys: ['⌘', 'V'] },
      { label: t('创建副本'), keys: ['⌘', 'D'] },
      { label: t('下载所选'), keys: ['⇧', 'D'] },
      { label: t('删除'), keys: ['⌫'] },
      { label: t('收藏'), keys: ['⇧', 'F'] },
      { label: t('添加到对话'), keys: ['⌘', 'L'] },
      { label: t('自定义变体'), keys: ['⇧', 'V'] },
      { label: t('重新生成'), keys: ['⇧', 'R'] },
    ],
  },
  {
    title: t('工具'),
    items: [
      { label: t('选择'), keys: ['V'] },
      { label: t('抓手'), keys: ['H'] },
      { label: t('平移（按住）'), keys: ['Space'] },
      { label: t('标记#mark'), keys: ['M'] },
      { label: t('直接编辑'), keys: ['E'] },
      { label: t('框选'), keys: ['⇧', t('拖动')] },
      { label: t('缩放（按住，⌥ 缩小）'), keys: ['Z'] },
      { label: t('显示连线'), keys: ['X'] },
    ],
  },
  {
    title: t('视图'),
    items: [
      { label: t('放大'), keys: ['⌘', '+'] },
      { label: t('缩小'), keys: ['⌘', '-'] },
      { label: t('缩放到 100%'), keys: ['⇧', '0'] },
      { label: t('适应画布'), keys: ['⇧', '1'] },
      { label: t('适应选中'), keys: ['⇧', '2'] },
      { label: t('移动视图'), keys: ['↑', '↓', '←', '→'] },
      { label: t('大步移动视图'), keys: ['⇧', '↑↓←→'] },
      { label: t('查看详情'), keys: ['I'] },
      { label: t('查看代码'), keys: ['⇧', 'C'] },
      { label: t('新标签页打开'), keys: ['⇧', 'P'] },
      { label: t('重新加载'), keys: ['⌘', 'R'] },
    ],
  },
  {
    title: t('导航'),
    items: [
      { label: t('聚焦所选'), keys: ['F'] },
      { label: t('下一屏'), keys: ['⌘', '→'] },
      { label: t('上一屏'), keys: ['⌘', '←'] },
      { label: t('上方的屏'), keys: ['⌘', '↑'] },
      { label: t('下方的屏'), keys: ['⌘', '↓'] },
    ],
  },
]
