import { t } from '../../i18n'
import type { MenuItem } from '../../ui'
import { FRAME_PRESETS, type FramePreset, type ScreenFrame } from './geometry'

/** Planned for a later round (docs/plan/原型编辑器-Stitch对标-开发计划.md §3): listed, disabled, with a help tag. */
const soon = (label: string, shortcut?: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  label,
  value: label,
  ...(shortcut ? { shortcut } : {}),
  disabled: true,
  title: t('即将支持'),
  ...extra,
})

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

const noBotTitle = (noBot: boolean) => (noBot ? { disabled: true, title: t('群里没有 Bot') } : {})
const gen = (label: string, command: string, noBot: boolean, shortcut?: string): MenuItem => ({
  label,
  value: `${CMD.generate}${command}`,
  ...(shortcut ? { shortcut } : {}),
  ...noBotTitle(noBot),
})

/** The selection toolbar's four menus (Stitch capability list §3, 选中屏幕); each item becomes an @bot message. */
export const generateItems = (noBot: boolean): MenuItem[] => [
  gen(t('即时原型'), 'instant-prototype', noBot),
  gen(t('变体'), 'variations', noBot),
  gen(t('重新生成'), 'regenerate', noBot, '⇧R'),
  gen(t('桌面网页版'), 'desktop-version', noBot),
  gen(t('补全状态'), 'missing-states', noBot),
  gen(t('动效'), 'animate', noBot),
  { separator: true },
  gen(t('应用商店素材'), 'app-store-assets', noBot),
  gen(t('网页素材'), 'web-assets', noBot),
  gen(t('营销物料'), 'marketing-kit', noBot),
  gen(t('无障碍检查'), 'accessibility-audit', noBot),
]

const variationItems = (noBot: boolean): MenuItem[] => [
  ...Object.entries(VARIATION_DIMENSIONS).map(([k, d]) => ({
    label: d.label,
    value: `${CMD.variations}${k}`,
    ...noBotTitle(noBot),
  })),
  {
    label: t('自定义…'),
    value: `${CMD.variations}${VARIATION_CUSTOM}`,
    shortcut: '⇧V',
    ...noBotTitle(noBot),
  },
]

const readOnlyTitle = (readOnly: boolean) => (readOnly ? { disabled: true, title: t('AI 正在修改') } : {})

export const modifyItems = (readOnly: boolean): MenuItem[] => [
  { label: t('编辑'), value: CMD.edit, shortcut: 'E', ...readOnlyTitle(readOnly) },
  { label: t('设计系统'), value: CMD.designSystem },
]

const PRESET_LABEL: Record<FramePreset, string> = {
  mobile: t('手机 390×884'),
  tablet: t('平板 768×1024'),
  desktop: t('桌面 1280×1024'),
}

/** `frame`: the selected screens' framing when they share one. */
export const previewItems = (single: boolean, frame: ScreenFrame | null): MenuItem[] => [
  {
    label: t('新标签页打开'),
    value: CMD.newTab,
    shortcut: '⇧P',
    disabled: !single,
    ...(single ? {} : { title: t('选中一个屏幕') }),
  },
  soon(t('显示二维码')),
  { separator: true },
  ...(Object.keys(FRAME_PRESETS) as FramePreset[]).map((p) => ({
    label: PRESET_LABEL[p],
    value: `${CMD.frame}${p}`,
    checked: frame?.w === FRAME_PRESETS[p].w,
  })),
  { separator: true },
  { label: t('全高'), value: CMD.fullHeight, checked: !!frame?.full },
]

export const moreItems = (readOnly: boolean): MenuItem[] => [
  { label: t('查看详情'), value: CMD.details, shortcut: 'I' },
  { label: t('查看代码'), value: CMD.code, shortcut: '⇧C' },
  soon(t('导出'), '⌘⇧E'),
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
  noBot: boolean
}): MenuItem[] {
  const ro = readOnlyTitle(o.readOnly)
  return [
    { label: t('添加到对话'), value: CMD.addToChat, shortcut: '⌘L' },
    { label: t('复制'), value: CMD.copy, shortcut: '⌘C' },
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
    { label: t('生成'), value: 'generate', submenu: generateItems(o.noBot) },
    { label: t('变体'), value: 'variations', submenu: variationItems(o.noBot) },
    gen(t('重新生成'), 'regenerate', o.noBot, '⇧R'),
    { separator: true },
    { header: t('编辑') },
    ...modifyItems(o.readOnly),
    { separator: true },
    { header: t('预览') },
    ...previewItems(o.single, o.frame).filter((it) => !('separator' in it)),
    { separator: true },
    { label: t('显示连线'), value: CMD.links, shortcut: 'X', checked: o.showAllLinks },
    ...moreItems(o.readOnly).filter((it) => 'value' in it && it.value !== CMD.remove && it.disabled !== true),
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

/** The shortcut sheet (Stitch capability list §9); `soon` ones are listed but not wired yet. */
export const SHORTCUTS: { title: string; items: { label: string; keys: string[]; soon?: boolean }[] }[] = [
  {
    title: t('通用'),
    items: [
      { label: t('快捷键'), keys: ['?'] },
      { label: t('保存'), keys: ['⌘', 'S'], soon: true },
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
      { label: t('复制'), keys: ['⌘', 'C'] },
      { label: t('粘贴'), keys: ['⌘', 'V'] },
      { label: t('创建副本'), keys: ['⌘', 'D'] },
      { label: t('下载所选'), keys: ['⇧', 'D'] },
      { label: t('删除'), keys: ['⌫'] },
      { label: t('收藏'), keys: ['⇧', 'F'] },
      { label: t('添加到对话'), keys: ['⌘', 'L'] },
      { label: t('自定义变体'), keys: ['⇧', 'V'] },
      { label: t('重新生成'), keys: ['⇧', 'R'] },
      { label: t('微移所选'), keys: ['⇧', '↑↓←→'], soon: true },
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
      { label: t('缩放（按住）'), keys: ['Z'], soon: true },
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
