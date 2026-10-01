import { type CSSProperties, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Avatar, type AvatarProps } from '../display'
import { SearchField } from '../form'
import { Icon } from '../icon'
import { SegmentedControl } from '../segmented'
import { Emoji } from './emoji'
import { keyNav } from './keynav'
import './pickers.css'

export interface MentionMember {
  id?: string
  name: string
  /** Department or title. */
  subtitle?: string
  /** Lets「zs」「zhang」match. */
  pinyin?: string
  avatar?: string
  status?: AvatarProps['status']
  /** The synthetic「所有人」row. */
  all?: boolean
}

const MAX_MENTIONS = 8

/** Name substring or pinyin prefix; 「所有人」first unless excluded; at most 8 rows. */
export function filterMembers(members: MentionMember[] = [], query = '', includeAll = true) {
  const q = query.toLowerCase()
  const list = members.filter(
    (m) => !q || m.name.toLowerCase().includes(q) || (m.pinyin ?? '').toLowerCase().startsWith(q),
  )
  const all = includeAll && (!q || t('所有人').toLowerCase().includes(q) || 'all'.startsWith(q))
  return (
    all
      ? [{ id: '__all', name: t('所有人'), subtitle: t('{n} 人', { n: members.length }), all: true }, ...list]
      : list
  ).slice(0, MAX_MENTIONS)
}

export interface MentionPickerProps {
  members?: MentionMember[]
  /** Pre-filtered rows (Composer passes these); otherwise `members` are filtered by `query`. */
  items?: MentionMember[]
  query?: string
  includeAll?: boolean
  activeIndex?: number
  onActiveChange?: (index: number) => void
  onSelect?: (member: MentionMember) => void
  /** Option ids are `${id}-${index}` for `aria-activedescendant`. */
  id?: string
  className?: string
  style?: CSSProperties
}

function highlight(name: string, q: string) {
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return name
  return (
    <>
      {name.slice(0, i)}
      <b>{name.slice(i, i + q.length)}</b>
      {name.slice(i + q.length)}
    </>
  )
}

/** @member list; the input keeps focus, so rows are driven by `activeIndex` and chosen on mousedown. */
export function MentionPicker({
  members,
  items,
  query = '',
  includeAll = true,
  activeIndex = 0,
  onActiveChange,
  onSelect,
  id,
  className,
  style,
}: MentionPickerProps) {
  const rows = items ?? filterMembers(members, query, includeAll)
  return (
    <div
      id={id}
      className={cx('pn-mentionpicker', className)}
      style={style}
      role="listbox"
      aria-label={t('选择要提及的人')}
    >
      <div className="pn-mentionpicker__head" aria-hidden="true">
        {query ? t('匹配「{query}」', { query }) : t('群成员')}
      </div>
      {rows.length ? (
        rows.map((m, i) => (
          <div
            key={m.id ?? m.name}
            id={id && `${id}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            tabIndex={-1}
            className="pn-mentionpicker__item"
            onMouseEnter={() => onActiveChange?.(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect?.(m)
            }}
          >
            {m.all ? (
              <span className="pn-mentionpicker__all">
                <Icon name="at" weight={1.8} />
              </span>
            ) : (
              <Avatar name={m.name} src={m.avatar} size={24} status={m.status} />
            )}
            <span className="pn-mentionpicker__name">{highlight(m.name, query)}</span>
            {m.subtitle && <span className="pn-mentionpicker__sub">{m.subtitle}</span>}
          </div>
        ))
      ) : (
        <div className="pn-mentionpicker__empty">{t('没有匹配的成员')}</div>
      )}
    </div>
  )
}

type EmojiEntry = readonly [emoji: string, keywords: string]
type EmojiCategory = 'recent' | 'smile' | 'hand' | 'symbol'

const EMOJI: { id: Exclude<EmojiCategory, 'recent'>; label: string; items: EmojiEntry[] }[] = [
  {
    id: 'smile',
    label: t('笑脸'),
    items: [
      ['😀', t('笑 开心')],
      ['😄', t('大笑 开心')],
      ['😂', t('笑哭')],
      ['🤣', t('打滚笑')],
      ['😊', t('微笑 害羞')],
      ['🙂', t('微笑')],
      ['😉', t('眨眼')],
      ['😍', t('喜欢 爱心眼')],
      ['🥳', t('庆祝 派对')],
      ['😎', t('酷 墨镜')],
      ['🤔', t('思考 想')],
      ['😮', t('惊讶 哇')],
      ['😅', t('尴尬 汗')],
      ['😴', t('困 睡觉')],
      ['😢', t('难过 哭')],
      ['😭', t('大哭')],
      ['😡', t('生气')],
      ['🤯', t('爆炸 震惊')],
      ['🥲', t('含泪笑')],
      ['😬', t('紧张')],
      ['🤗', t('拥抱')],
      ['🫡', t('敬礼 收到')],
      ['🙃', t('倒脸')],
      ['😇', t('天使')],
    ],
  },
  {
    id: 'hand',
    label: t('手势'),
    items: [
      ['👍', t('赞 好 同意')],
      ['👎', t('踩 不同意')],
      ['👌', t('好的 OK')],
      ['🙏', t('谢谢 拜托')],
      ['👏', t('鼓掌')],
      ['🙌', t('举手 庆祝')],
      ['💪', t('加油 强')],
      ['🤝', t('握手 合作')],
      ['👋', t('你好 再见 挥手')],
      ['✌️', t('耶 胜利')],
      ['🤞', t('祈祷 好运')],
      ['👀', t('看 关注')],
      ['✋', t('举手 停')],
      ['🫶', t('比心')],
      ['☝️', t('一 注意')],
      ['👉', t('这里 指')],
    ],
  },
  {
    id: 'symbol',
    label: t('符号'),
    items: [
      ['✅', t('完成 对 已处理')],
      ['❌', t('错 不行')],
      ['⭕', t('对 可以')],
      ['❗', t('重要 注意')],
      ['❓', t('问题 疑问')],
      ['🔥', t('火 热门')],
      ['✨', t('闪亮 新')],
      ['🎉', t('庆祝 撒花')],
      ['❤️', t('爱心 喜欢')],
      ['💯', t('满分 一百')],
      ['⚡', t('闪电 加急')],
      ['🚀', t('火箭 上线 发布')],
      ['📌', t('置顶 固定')],
      ['📎', t('附件#emoji')],
      ['📅', t('日程 日历')],
      ['☕', t('咖啡 休息')],
      ['🍵', t('茶')],
      ['🎯', t('目标')],
      ['💡', t('想法 灯泡')],
      ['⏰', t('闹钟 时间')],
    ],
  },
]

const ALL = EMOJI.flatMap((g) => g.items)
const DEFAULT_RECENT = ['👍', '✅', '🎉', '😄', '🙏', '👀', '🔥', '💪']
const CATEGORIES = [
  { value: 'recent' as const, label: t('常用') },
  ...EMOJI.map((g) => ({ value: g.id, label: g.label })),
]
const COLS = 8

export interface EmojiPickerProps {
  onSelect?: (emoji: string) => void
  /** 常用 row; defaults to 👍 ✅ 🎉 😄 🙏 👀 🔥 💪. */
  recent?: string[]
  defaultCategory?: EmojiCategory
  /** A fixed set (e.g. the reactions a server accepts): just the grid, no search or categories. */
  only?: readonly string[]
  /** Emojis already chosen (my reactions): marked selected. */
  selected?: readonly string[]
  className?: string
  style?: CSSProperties
}

/** Emoji panel: search by Chinese keyword, four categories, an 8-column grid walked with arrow keys. */
export function EmojiPicker({
  onSelect,
  recent = DEFAULT_RECENT,
  defaultCategory = 'recent',
  only,
  selected = [],
  className,
  style,
}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<EmojiCategory>(defaultCategory)
  const grid = useRef<HTMLDivElement>(null)
  const q = query.trim()
  const entry = (e: string): EmojiEntry => ALL.find((it) => it[0] === e) ?? [e, e]
  const items: EmojiEntry[] = only
    ? only.map(entry)
    : q
      ? ALL.filter((it) => it[1].includes(q.toLowerCase()))
      : cat === 'recent'
        ? recent.map(entry)
        : (EMOJI.find((g) => g.id === cat)?.items ?? [])
  return (
    <div
      className={cx('pn-emoji', only && 'pn-emoji--fixed', className)}
      style={style}
      role="dialog"
      aria-label={t('选择表情')}
    >
      {!only && (
        <SearchField
          placeholder={t('搜索表情')}
          value={query}
          onChange={setQuery}
          style={{ minWidth: 0, width: '100%' }}
        />
      )}
      {!q && !only && (
        <SegmentedControl
          size="small"
          items={CATEGORIES}
          value={cat}
          onChange={setCat}
          aria-label={t('表情分类')}
        />
      )}
      {items.length ? (
        <div
          ref={grid}
          className="pn-emoji__grid"
          role="listbox"
          aria-label={q ? t('搜索结果') : t('表情')}
          onKeyDown={(e) => keyNav(e, grid.current, '.pn-emoji__cell', { cols: COLS })}
        >
          {items.map(([emoji, words], i) => {
            const name = words.split(' ')[0]
            return (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={selected.includes(emoji)}
                tabIndex={i === 0 ? 0 : -1}
                className="pn-emoji__cell"
                title={name}
                aria-label={name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect?.(emoji)}
              >
                <Emoji char={emoji} />
              </button>
            )
          })}
        </div>
      ) : (
        <div className="pn-emoji__empty">{t('没有找到相关表情')}</div>
      )}
    </div>
  )
}
