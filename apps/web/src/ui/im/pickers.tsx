import { type CSSProperties, useRef, useState } from 'react'
import { cx } from '../../lib/cx'
import { Avatar, type AvatarProps } from '../display'
import { SearchField } from '../form'
import { Icon } from '../icon'
import { SegmentedControl } from '../segmented'
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
  const all = includeAll && (!q || '所有人'.includes(q) || 'all'.startsWith(q))
  return (
    all ? [{ id: '__all', name: '所有人', subtitle: `${members.length} 人`, all: true }, ...list] : list
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
      aria-label="选择要提及的人"
    >
      <div className="pn-mentionpicker__head" aria-hidden="true">
        {query ? `匹配「${query}」` : '群成员'}
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
        <div className="pn-mentionpicker__empty">没有匹配的成员</div>
      )}
    </div>
  )
}

type EmojiEntry = readonly [emoji: string, keywords: string]
type EmojiCategory = 'recent' | 'smile' | 'hand' | 'symbol'

const EMOJI: { id: Exclude<EmojiCategory, 'recent'>; label: string; items: EmojiEntry[] }[] = [
  {
    id: 'smile',
    label: '笑脸',
    items: [
      ['😀', '笑 开心'],
      ['😄', '大笑 开心'],
      ['😂', '笑哭'],
      ['🤣', '打滚笑'],
      ['😊', '微笑 害羞'],
      ['🙂', '微笑'],
      ['😉', '眨眼'],
      ['😍', '喜欢 爱心眼'],
      ['🥳', '庆祝 派对'],
      ['😎', '酷 墨镜'],
      ['🤔', '思考 想'],
      ['😮', '惊讶 哇'],
      ['😅', '尴尬 汗'],
      ['😴', '困 睡觉'],
      ['😢', '难过 哭'],
      ['😭', '大哭'],
      ['😡', '生气'],
      ['🤯', '爆炸 震惊'],
      ['🥲', '含泪笑'],
      ['😬', '紧张'],
      ['🤗', '拥抱'],
      ['🫡', '敬礼 收到'],
      ['🙃', '倒脸'],
      ['😇', '天使'],
    ],
  },
  {
    id: 'hand',
    label: '手势',
    items: [
      ['👍', '赞 好 同意'],
      ['👎', '踩 不同意'],
      ['👌', '好的 OK'],
      ['🙏', '谢谢 拜托'],
      ['👏', '鼓掌'],
      ['🙌', '举手 庆祝'],
      ['💪', '加油 强'],
      ['🤝', '握手 合作'],
      ['👋', '你好 再见 挥手'],
      ['✌️', '耶 胜利'],
      ['🤞', '祈祷 好运'],
      ['👀', '看 关注'],
      ['✋', '举手 停'],
      ['🫶', '比心'],
      ['☝️', '一 注意'],
      ['👉', '这里 指'],
    ],
  },
  {
    id: 'symbol',
    label: '符号',
    items: [
      ['✅', '完成 对 已处理'],
      ['❌', '错 不行'],
      ['⭕', '对 可以'],
      ['❗', '重要 注意'],
      ['❓', '问题 疑问'],
      ['🔥', '火 热门'],
      ['✨', '闪亮 新'],
      ['🎉', '庆祝 撒花'],
      ['❤️', '爱心 喜欢'],
      ['💯', '满分 一百'],
      ['⚡', '闪电 加急'],
      ['🚀', '火箭 上线 发布'],
      ['📌', '置顶 固定'],
      ['📎', '附件'],
      ['📅', '日程 日历'],
      ['☕', '咖啡 休息'],
      ['🍵', '茶'],
      ['🎯', '目标'],
      ['💡', '想法 灯泡'],
      ['⏰', '闹钟 时间'],
    ],
  },
]

const ALL = EMOJI.flatMap((g) => g.items)
const DEFAULT_RECENT = ['👍', '✅', '🎉', '😄', '🙏', '👀', '🔥', '💪']
const CATEGORIES = [
  { value: 'recent' as const, label: '常用' },
  ...EMOJI.map((g) => ({ value: g.id, label: g.label })),
]
const COLS = 8

export interface EmojiPickerProps {
  onSelect?: (emoji: string) => void
  /** 常用 row; defaults to 👍 ✅ 🎉 😄 🙏 👀 🔥 💪. */
  recent?: string[]
  defaultCategory?: EmojiCategory
  className?: string
  style?: CSSProperties
}

/** Emoji panel: search by Chinese keyword, four categories, an 8-column grid walked with arrow keys. */
export function EmojiPicker({
  onSelect,
  recent = DEFAULT_RECENT,
  defaultCategory = 'recent',
  className,
  style,
}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<EmojiCategory>(defaultCategory)
  const grid = useRef<HTMLDivElement>(null)
  const q = query.trim()
  const items: EmojiEntry[] = q
    ? ALL.filter((it) => it[1].includes(q))
    : cat === 'recent'
      ? recent.map((e) => ALL.find((it) => it[0] === e) ?? [e, e])
      : (EMOJI.find((g) => g.id === cat)?.items ?? [])
  return (
    <div className={cx('pn-emoji', className)} style={style} role="dialog" aria-label="选择表情">
      <SearchField
        placeholder="搜索表情"
        value={query}
        onChange={setQuery}
        style={{ minWidth: 0, width: '100%' }}
      />
      {!q && (
        <SegmentedControl
          size="small"
          items={CATEGORIES}
          value={cat}
          onChange={setCat}
          aria-label="表情分类"
        />
      )}
      {items.length ? (
        <div
          ref={grid}
          className="pn-emoji__grid"
          role="listbox"
          aria-label={q ? '搜索结果' : '表情'}
          onKeyDown={(e) => keyNav(e, grid.current, '.pn-emoji__cell', { cols: COLS })}
        >
          {items.map(([emoji, words], i) => {
            const name = words.split(' ')[0]
            return (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={false}
                tabIndex={i === 0 ? 0 : -1}
                className="pn-emoji__cell"
                title={name}
                aria-label={name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect?.(emoji)}
              >
                {emoji}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="pn-emoji__empty">没有找到相关表情</div>
      )}
    </div>
  )
}
