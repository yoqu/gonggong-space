import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Icon, IconButton, type IconName, MenuButton, type MenuItem, Tooltip } from '../../ui'

export { ActivityLayer } from './ActivityLayer'

/** The title's inline rename (Stitch's Rename): Enter saves, Esc or leaving cancels. */
export function RenameField({
  title,
  style,
  onDone,
}: {
  title: string
  style: CSSProperties
  onDone: (title: string | null) => void
}) {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      className="art-title art-title__input"
      style={style}
      aria-label={t('重命名')}
      value={value}
      maxLength={80}
      // biome-ignore lint/a11y/noAutofocus: opened on purpose by Rename
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(value.trim() || null)
        else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={() => finish(null)}
    />
  )
}

/** A menu of the selection toolbar; `compact` (a narrow canvas) shows its icon only, the label in a tooltip. */
export function FloatMenu({
  icon,
  label,
  compact,
  items,
  onSelect,
}: {
  icon: IconName
  label: string
  compact: boolean
  items: MenuItem[]
  onSelect: (value: string) => void
}) {
  const menu = (
    <MenuButton
      className="ui-btn ui-btn--plain ui-btn--small art-float__btn"
      aria-label={compact ? label : undefined}
      items={items}
      onSelect={onSelect}
    >
      <Icon name={icon} size={14} />
      {compact ? null : label}
      <Icon name="chevron-down" size={10} weight={2} />
    </MenuButton>
  )
  return compact ? (
    <Tooltip content={label} placement="bottom">
      {menu}
    </Tooltip>
  ) : (
    menu
  )
}

/**
 * A tool of the right-hand toolbar; tools without `onClick` are not available (yet), `off` says why one is not right
 * now. `badge`: a count on its corner (open annotations).
 */
export function ToolButton({
  icon,
  label,
  shortcut,
  on,
  off,
  badge = 0,
  onClick,
}: {
  icon: IconName
  label: string
  shortcut?: string
  on?: boolean
  off?: string
  badge?: number
  onClick?: () => void
}): ReactElement {
  const usable = !!onClick && !off
  return (
    <Tooltip
      content={
        off
          ? `${label} · ${off}`
          : onClick
            ? badge
              ? t('{name}（{n} 条待处理）', { name: label, n: badge })
              : label
            : t('{name}（即将支持）', { name: label })
      }
      shortcut={shortcut}
      placement="left"
    >
      <button
        type="button"
        className="art-tools__btn"
        aria-label={label}
        aria-pressed={usable && on !== undefined ? !!on : undefined}
        disabled={!usable}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
        {badge ? (
          <span className="art-tools__badge" data-testid="art-tool-badge">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  )
}

/** The canvas's tips (bottom left), one at a time; closing them is remembered. */
const TIPS = [
  t('双击屏幕放大查看'),
  t('选中屏幕后在左侧对话里描述修改，不用 @'),
  t('可以说「点 X 时打开下一屏」，AI 会连好跳转'),
  t('按 ⌘K 搜索所有命令，⇧ 拖动框选多个屏幕'),
]
const TIPS_KEY = 'gg.art.tips'
const TIP_MS = 8000

const MODE_LABEL: Record<'play' | 'mark' | 'edit', string> = {
  play: t('交互模式 · 点击操作页面'),
  mark: t('标记模式 · 点选页面元素'),
  edit: t('直接编辑 · 点击修改文字'),
}

/** `through`: the pages take clicks (`pick`: 标记 / 直接编辑, `play`: 交互), so it says how to work them instead. */
export function CanvasTips({
  through,
  mode,
}: {
  through: 'pick' | 'play' | null
  mode?: 'play' | 'mark' | 'edit' | null
}): ReactElement | null {
  const [tip, setTip] = useState(() => (localStorage.getItem(TIPS_KEY) === 'off' ? -1 : 0))
  const [dismissedMode, setDismissedMode] = useState<'play' | 'mark' | 'edit' | null>(null)
  // Reset narrow-screen mode pill dismissal whenever the active mode changes.
  useEffect(() => {
    if (!mode || mode !== dismissedMode) setDismissedMode(null)
  }, [mode, dismissedMode])
  // Tips turn over by themselves until closed.
  useEffect(() => {
    if (tip < 0 || through) return
    const timer = setTimeout(() => setTip((i) => (i < 0 ? i : i + 1)), TIP_MS)
    return () => clearTimeout(timer)
  }, [tip, through])
  if (through)
    return (
      <>
        <div className="art-tip" role="status" data-testid="art-through">
          <Icon name="cursor" size={14} />
          <span>
            {through === 'play'
              ? t('直接点击操作页面，切回标记/编辑可选元素')
              : t('按住 ⌥/Alt 点击或切到交互工具（P）可操作页面，再点选其中的元素')}
          </span>
        </div>
        {mode && dismissedMode !== mode ? (
          <div className="art-mode-pill" role="status" data-testid="art-mode-pill">
            <Icon name="cursor" size={13} />
            <span>{MODE_LABEL[mode]}</span>
            <IconButton size="small" title={t('关闭模式提示')} onClick={() => setDismissedMode(mode)}>
              {'xmark' as const}
            </IconButton>
          </div>
        ) : null}
      </>
    )
  if (tip < 0) return null
  return (
    <div className="art-tip" role="status" data-testid="art-tip">
      <Icon name="sparkle" size={14} />
      <span>{TIPS[tip % TIPS.length]}</span>
      <button type="button" className="art-tip__next" onClick={() => setTip((i) => i + 1)}>
        {t('下一条')}
      </button>
      <IconButton
        size="small"
        title={t('不再显示提示')}
        onClick={() => {
          localStorage.setItem(TIPS_KEY, 'off')
          setTip(-1)
        }}
      >
        {'xmark' as const}
      </IconButton>
    </div>
  )
}
