import { t } from '../../i18n'
import type { MenuItem } from '../../ui'

/** Planned for a later round (docs/plan/原型编辑器-Stitch对标-开发计划.md §3): listed, disabled, with a help tag. */
const soon = (label: string, shortcut?: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  label,
  value: label,
  ...(shortcut ? { shortcut } : {}),
  disabled: true,
  title: t('即将支持'),
  ...extra,
})

/** The selection toolbar's four menus (Stitch capability list §3, 选中屏幕). */
export const GENERATE_ITEMS: MenuItem[] = [
  soon(t('即时原型')),
  soon(t('变体'), '⇧V'),
  soon(t('重新生成'), '⇧R'),
  soon(t('桌面网页版')),
  soon(t('补全状态')),
  soon(t('动效')),
  { separator: true },
  soon(t('应用商店素材')),
  soon(t('网页素材')),
  soon(t('营销物料')),
  soon(t('无障碍检查')),
]

export const MODIFY_ITEMS: MenuItem[] = [soon(t('编辑'), 'E'), soon('DESIGN.md')]

export const PREVIEW_NEW_TAB = 'new-tab'
export const previewItems = (canOpen: boolean): MenuItem[] => [
  {
    label: t('新标签页打开'),
    value: PREVIEW_NEW_TAB,
    shortcut: '⇧P',
    disabled: !canOpen,
    ...(canOpen ? {} : { title: t('选中一个屏幕') }),
  },
  soon(t('显示二维码')),
  { separator: true },
  soon(t('手机 390×884')),
  soon(t('平板 768×1024')),
  soon(t('桌面 1280×1024')),
  soon(t('全高')),
]

export const MORE_RELOAD = 'reload'
export const MORE_ITEMS: MenuItem[] = [
  soon(t('查看详情'), 'I'),
  soon(t('查看代码'), '⇧C'),
  soon(t('导出'), '⌘⇧E'),
  soon(t('下载'), '⇧D'),
  { label: t('重新加载'), value: MORE_RELOAD, shortcut: '⌘R' },
  { separator: true },
  soon(t('删除'), '⌫', { destructive: true }),
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
      { label: t('剪切'), keys: ['⌘', 'X'], soon: true },
      { label: t('拷贝'), keys: ['⌘', 'C'], soon: true },
      { label: t('粘贴'), keys: ['⌘', 'V'], soon: true },
      { label: t('复制一份'), keys: ['⌘', 'D'], soon: true },
      { label: t('下载所选'), keys: ['⇧', 'D'], soon: true },
      { label: t('删除'), keys: ['⌫'], soon: true },
      { label: t('微移所选'), keys: ['↑', '↓', '←', '→'], soon: true },
      { label: t('对齐所选'), keys: ['⇧', '↑↓←→'], soon: true },
    ],
  },
  {
    title: t('工具'),
    items: [
      { label: t('选择'), keys: ['V'] },
      { label: t('抓手'), keys: ['H'] },
      { label: t('平移（按住）'), keys: ['Space'] },
      { label: t('标记#mark'), keys: ['M'], soon: true },
      { label: t('直接编辑'), keys: ['E'], soon: true },
      { label: t('缩放（按住）'), keys: ['Z'], soon: true },
      { label: t('显示连线'), keys: ['X'], soon: true },
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
    ],
  },
  {
    title: t('导航'),
    items: [
      { label: t('聚焦所选'), keys: ['F'], soon: true },
      { label: t('下一屏'), keys: ['⌘', '→'], soon: true },
      { label: t('上一屏'), keys: ['⌘', '←'], soon: true },
      { label: t('上方的屏'), keys: ['⌘', '↑'], soon: true },
      { label: t('下方的屏'), keys: ['⌘', '↓'], soon: true },
    ],
  },
]
