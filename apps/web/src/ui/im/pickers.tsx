import { type CSSProperties, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { matchAny, matchText } from '../../lib/match'
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

/** Name by substring or pinyin (full, initials, mixed); 「所有人」first unless excluded; at most 8 rows. */
export function filterMembers(members: MentionMember[] = [], query = '', includeAll = true) {
  const q = query.toLowerCase()
  const list = members.filter((m) => matchAny(q, m.name, m.pinyin))
  const all = includeAll && (matchAny(q, t('所有人')) || 'all'.startsWith(q))
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
  const hit = new Set(matchText(name, q))
  if (!hit.size) return name
  // Runs of hit / missed characters, so a pinyin match like「jwc」bolds「姜维川」as one span.
  const runs: { text: string; on: boolean }[] = []
  name.split('').forEach((c, i) => {
    const last = runs.at(-1)
    if (last && last.on === hit.has(i)) last.text += c
    else runs.push({ text: c, on: hit.has(i) })
  })
  // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one name never reorder
  return runs.map((r, i) => (r.on ? <b key={i}>{r.text}</b> : r.text))
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
type EmojiCategory = 'recent' | 'smile' | 'hand' | 'nature' | 'food' | 'activity' | 'object' | 'symbol'

const EMOJI: { id: Exclude<EmojiCategory, 'recent'>; label: string; items: EmojiEntry[] }[] = [
  {
    id: 'smile',
    label: t('笑脸'),
    items: [
      ['😀', t('笑 开心')],
      ['😃', t('张嘴笑 高兴')],
      ['😄', t('大笑 开心')],
      ['😁', t('露齿笑 嘻嘻')],
      ['😆', t('眯眼笑 哈哈')],
      ['😅', t('尴尬 汗')],
      ['😂', t('笑哭')],
      ['🤣', t('打滚笑')],
      ['🥲', t('含泪笑')],
      ['😊', t('微笑 害羞')],
      ['😇', t('天使')],
      ['🙂', t('微笑')],
      ['🙃', t('倒脸')],
      ['😉', t('眨眼')],
      ['😌', t('欣慰 放松')],
      ['😍', t('喜欢 爱心眼')],
      ['🥰', t('爱你 甜蜜')],
      ['😘', t('飞吻')],
      ['😋', t('好吃 馋')],
      ['😛', t('吐舌')],
      ['😜', t('调皮')],
      ['🤪', t('搞怪 疯狂')],
      ['🤨', t('怀疑 挑眉')],
      ['🧐', t('研究 单片眼镜')],
      ['🤓', t('学霸 书呆子')],
      ['😎', t('酷 墨镜')],
      ['🤩', t('崇拜 星星眼')],
      ['🥳', t('庆祝 派对')],
      ['😏', t('得意 坏笑')],
      ['😒', t('不爽 无语')],
      ['😞', t('失望')],
      ['😔', t('沮丧')],
      ['😟', t('担心')],
      ['😕', t('困惑')],
      ['🙁', t('不开心')],
      ['😣', t('坚持 痛苦')],
      ['😖', t('纠结')],
      ['😫', t('累 疲惫')],
      ['😩', t('崩溃')],
      ['🥺', t('可怜 求求')],
      ['😢', t('难过 哭')],
      ['😭', t('大哭')],
      ['😤', t('哼 傲娇')],
      ['😠', t('恼火')],
      ['😡', t('生气')],
      ['🤬', t('骂人')],
      ['🤯', t('爆炸 震惊')],
      ['😳', t('脸红')],
      ['🥵', t('热 好热')],
      ['🥶', t('冷 好冷')],
      ['😱', t('惊恐 吓死')],
      ['😨', t('害怕')],
      ['😰', t('焦虑 冒冷汗')],
      ['😓', t('无奈 流汗')],
      ['🤗', t('拥抱')],
      ['🤔', t('思考 想')],
      ['🫢', t('捂嘴 惊呆')],
      ['🤭', t('偷笑')],
      ['🤫', t('嘘 安静')],
      ['🫠', t('融化')],
      ['🤥', t('说谎')],
      ['😶', t('沉默 无言')],
      ['😐', t('面无表情')],
      ['🙄', t('翻白眼')],
      ['😯', t('吃惊')],
      ['😮', t('惊讶 哇')],
      ['😲', t('震惊 目瞪口呆')],
      ['🥱', t('打哈欠')],
      ['😴', t('困 睡觉')],
      ['🤤', t('流口水')],
      ['😪', t('犯困')],
      ['😵', t('晕')],
      ['🤐', t('闭嘴')],
      ['🥴', t('晕乎 醉')],
      ['🤢', t('恶心')],
      ['🤮', t('吐')],
      ['🤧', t('打喷嚏 感冒')],
      ['😷', t('口罩 生病')],
      ['🤒', t('发烧')],
      ['🤕', t('受伤')],
      ['🤑', t('发财 钱')],
      ['🤠', t('牛仔')],
      ['😈', t('恶魔 坏')],
      ['👻', t('鬼')],
      ['💀', t('骷髅')],
      ['🤡', t('小丑')],
      ['💩', t('便便')],
      ['🤖', t('机器人 AI')],
      ['👽', t('外星人')],
      ['😬', t('紧张')],
      ['🫡', t('敬礼 收到')],
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
      ['👈', t('左边')],
      ['👆', t('上面')],
      ['👇', t('下面')],
      ['🫵', t('你')],
      ['👊', t('拳头 冲')],
      ['✊', t('握拳 团结')],
      ['🤟', t('爱你手势')],
      ['🤘', t('摇滚')],
      ['🤙', t('打电话给我')],
      ['🖐️', t('五 张开手')],
      ['🤲', t('捧')],
      ['✍️', t('写 签字')],
      ['🤳', t('自拍')],
      ['🙋', t('我来 举手的人')],
      ['🙅', t('不行 拒绝')],
      ['🙆', t('可以 比OK')],
      ['💁', t('介绍')],
      ['🤷', t('摊手 不知道')],
      ['🤦', t('捂脸')],
      ['🙇', t('鞠躬 抱歉')],
      ['🧑‍💻', t('程序员 写代码')],
      ['🧑‍💼', t('打工人 上班')],
      ['🏃', t('跑')],
      ['🚶', t('走路')],
      ['🧘', t('冥想')],
      ['💃', t('跳舞')],
      ['👶', t('宝宝')],
      ['👦', t('男孩')],
      ['👧', t('女孩')],
      ['👴', t('爷爷')],
      ['👵', t('奶奶')],
      ['👨‍👩‍👧', t('一家人 家庭')],
    ],
  },
  {
    id: 'nature',
    label: t('自然'),
    items: [
      ['🐶', t('狗')],
      ['🐱', t('猫')],
      ['🐭', t('老鼠')],
      ['🐹', t('仓鼠')],
      ['🐰', t('兔子')],
      ['🦊', t('狐狸')],
      ['🐻', t('熊')],
      ['🐼', t('熊猫')],
      ['🐨', t('考拉')],
      ['🐯', t('老虎')],
      ['🦁', t('狮子')],
      ['🐮', t('牛 牛气')],
      ['🐷', t('猪')],
      ['🐸', t('青蛙')],
      ['🐵', t('猴子')],
      ['🐔', t('鸡')],
      ['🐧', t('企鹅')],
      ['🐦', t('鸟')],
      ['🦆', t('鸭子')],
      ['🦉', t('猫头鹰 夜猫子')],
      ['🐴', t('马')],
      ['🐝', t('蜜蜂 勤劳')],
      ['🦋', t('蝴蝶')],
      ['🐛', t('虫 bug')],
      ['🐌', t('蜗牛 慢')],
      ['🐢', t('乌龟')],
      ['🐍', t('蛇')],
      ['🐙', t('章鱼')],
      ['🐟', t('鱼 摸鱼')],
      ['🐳', t('鲸鱼')],
      ['🐬', t('海豚')],
      ['🦀', t('螃蟹')],
      ['🐲', t('龙')],
      ['🌸', t('樱花 花')],
      ['🌹', t('玫瑰')],
      ['🌻', t('向日葵')],
      ['🌷', t('郁金香')],
      ['💐', t('花束')],
      ['🌱', t('发芽 新芽')],
      ['🌲', t('树')],
      ['🍀', t('幸运 四叶草')],
      ['🍁', t('枫叶 秋天')],
      ['🌵', t('仙人掌')],
      ['☀️', t('太阳 晴天')],
      ['🌙', t('月亮 晚安')],
      ['⭐', t('星星')],
      ['🌈', t('彩虹')],
      ['☁️', t('云')],
      ['⛅', t('多云')],
      ['🌧️', t('下雨')],
      ['⛈️', t('雷雨')],
      ['❄️', t('雪 冬天')],
      ['⛄', t('雪人')],
      ['🌊', t('海浪')],
      ['💧', t('水滴')],
      ['🌍', t('地球 世界')],
    ],
  },
  {
    id: 'food',
    label: t('食物'),
    items: [
      ['🍎', t('苹果')],
      ['🍊', t('橘子')],
      ['🍋', t('柠檬 酸')],
      ['🍌', t('香蕉')],
      ['🍉', t('西瓜 吃瓜')],
      ['🍇', t('葡萄')],
      ['🍓', t('草莓')],
      ['🍑', t('桃子')],
      ['🍒', t('樱桃')],
      ['🥭', t('芒果')],
      ['🍍', t('菠萝')],
      ['🥝', t('猕猴桃')],
      ['🍅', t('番茄')],
      ['🥑', t('牛油果')],
      ['🌽', t('玉米')],
      ['🌶️', t('辣椒 辣')],
      ['🥕', t('胡萝卜')],
      ['🍞', t('面包')],
      ['🥐', t('可颂')],
      ['🥚', t('鸡蛋')],
      ['🍳', t('煎蛋 早餐')],
      ['🍔', t('汉堡')],
      ['🍟', t('薯条')],
      ['🍕', t('披萨')],
      ['🌭', t('热狗')],
      ['🥪', t('三明治')],
      ['🍜', t('面条 拉面')],
      ['🍲', t('火锅 一锅')],
      ['🍚', t('米饭')],
      ['🍛', t('咖喱饭')],
      ['🍣', t('寿司')],
      ['🥟', t('饺子')],
      ['🍤', t('炸虾')],
      ['🍙', t('饭团')],
      ['🍢', t('串 关东煮')],
      ['🍦', t('冰淇淋')],
      ['🍰', t('蛋糕')],
      ['🎂', t('生日蛋糕 生日')],
      ['🍪', t('饼干')],
      ['🍫', t('巧克力')],
      ['🍬', t('糖果')],
      ['🍭', t('棒棒糖')],
      ['🍩', t('甜甜圈')],
      ['🍿', t('爆米花 看戏')],
      ['☕', t('咖啡 休息')],
      ['🍵', t('茶')],
      ['🧋', t('奶茶')],
      ['🥤', t('饮料')],
      ['🥛', t('牛奶')],
      ['🍺', t('啤酒')],
      ['🍻', t('干杯')],
      ['🥂', t('碰杯')],
      ['🍷', t('红酒')],
    ],
  },
  {
    id: 'activity',
    label: t('活动'),
    items: [
      ['⚽', t('足球')],
      ['🏀', t('篮球')],
      ['🎾', t('网球')],
      ['🏐', t('排球')],
      ['🏓', t('乒乓球')],
      ['🏸', t('羽毛球')],
      ['⛳', t('高尔夫')],
      ['🏊', t('游泳')],
      ['🚴', t('骑行')],
      ['🏋️', t('健身 举重')],
      ['⛷️', t('滑雪')],
      ['🏆', t('奖杯 冠军')],
      ['🥇', t('金牌 第一')],
      ['🥈', t('银牌 第二')],
      ['🥉', t('铜牌 第三')],
      ['🏅', t('奖牌')],
      ['🎊', t('彩球 喜庆')],
      ['🎈', t('气球')],
      ['🎁', t('礼物')],
      ['🎀', t('蝴蝶结')],
      ['🧧', t('红包')],
      ['🏮', t('灯笼 春节')],
      ['🎆', t('烟花')],
      ['🎄', t('圣诞')],
      ['🎃', t('南瓜 万圣节')],
      ['🎮', t('游戏')],
      ['🎲', t('骰子')],
      ['🧩', t('拼图')],
      ['🎨', t('画画 设计')],
      ['🎬', t('电影 拍摄')],
      ['🎤', t('唱歌 麦克风')],
      ['🎧', t('耳机 听歌')],
      ['🎵', t('音乐')],
      ['🎸', t('吉他')],
      ['🎹', t('钢琴')],
      ['📷', t('相机 拍照')],
    ],
  },
  {
    id: 'object',
    label: t('物品'),
    items: [
      ['💻', t('电脑')],
      ['🖥️', t('显示器')],
      ['⌨️', t('键盘')],
      ['🖱️', t('鼠标#emoji')],
      ['📱', t('手机')],
      ['☎️', t('座机')],
      ['🔋', t('电池 电量')],
      ['🔌', t('插头')],
      ['💾', t('软盘 存盘')],
      ['🖨️', t('打印机')],
      ['⌚', t('手表')],
      ['⏳', t('沙漏 等待')],
      ['📝', t('笔记 记录')],
      ['📄', t('文档#emoji')],
      ['📊', t('柱状图 数据')],
      ['📈', t('增长 上涨')],
      ['📉', t('下降 下跌')],
      ['📋', t('剪贴板 清单')],
      ['📁', t('文件夹#emoji')],
      ['📦', t('包裹 打包')],
      ['📧', t('邮件#emoji')],
      ['✉️', t('信封')],
      ['📢', t('广播 公告')],
      ['🔔', t('铃铛 提醒')],
      ['🔕', t('静音铃铛 免打扰')],
      ['🔍', t('放大镜 查找')],
      ['🔒', t('锁 安全')],
      ['🔓', t('解锁')],
      ['🔑', t('钥匙 密码')],
      ['🔧', t('扳手 修复')],
      ['🔨', t('锤子')],
      ['🛠️', t('工具#emoji')],
      ['⚙️', t('齿轮 配置')],
      ['🧪', t('实验 测试')],
      ['💊', t('药')],
      ['💰', t('钱袋')],
      ['💳', t('银行卡 支付')],
      ['🧾', t('收据 发票')],
      ['🛒', t('购物车')],
      ['📚', t('书 学习')],
      ['📖', t('阅读')],
      ['✏️', t('铅笔')],
      ['✂️', t('剪刀')],
      ['🗑️', t('垃圾桶')],
      ['🏠', t('家 房子')],
      ['🏢', t('公司 办公楼')],
      ['🏥', t('医院')],
      ['🚗', t('汽车 开车')],
      ['🚕', t('出租车')],
      ['🚌', t('公交')],
      ['🚇', t('地铁')],
      ['🚄', t('高铁')],
      ['✈️', t('飞机 出差')],
      ['🚲', t('自行车')],
      ['🚦', t('红绿灯')],
      ['🗺️', t('地图#emoji')],
      ['🏖️', t('海滩 度假')],
      ['🏕️', t('露营')],
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
      ['⚠️', t('警告 风险')],
      ['🚫', t('禁止 不许')],
      ['⛔', t('停止 禁止通行')],
      ['🔥', t('火 热门')],
      ['✨', t('闪亮 新')],
      ['🎉', t('庆祝 撒花')],
      ['💯', t('满分 一百')],
      ['⚡', t('闪电 加急')],
      ['🚀', t('火箭 上线 发布')],
      ['📌', t('置顶 固定')],
      ['📎', t('附件#emoji')],
      ['📅', t('日程 日历')],
      ['🎯', t('目标')],
      ['💡', t('想法 灯泡')],
      ['⏰', t('闹钟 时间')],
      ['❤️', t('爱心 喜欢')],
      ['💔', t('心碎')],
      ['💕', t('两颗心')],
      ['💛', t('黄心')],
      ['💚', t('绿心')],
      ['💙', t('蓝心')],
      ['💜', t('紫心')],
      ['💬', t('消息 聊天')],
      ['💭', t('思考气泡')],
      ['💤', t('瞌睡 zzz')],
      ['💥', t('碰撞 爆')],
      ['🆕', t('新的 NEW')],
      ['🆘', t('求救 SOS')],
      ['🔴', t('红色 红点')],
      ['🟡', t('黄色 黄点')],
      ['🟢', t('绿色 绿点')],
      ['🔵', t('蓝色 蓝点')],
      ['⬆️', t('向上')],
      ['⬇️', t('向下')],
      ['⬅️', t('向左')],
      ['➡️', t('向右')],
      ['🔄', t('循环 刷新')],
      ['➕', t('加号')],
      ['➖', t('减号')],
      ['✔️', t('勾')],
      ['🔗', t('链接#emoji')],
      ['♻️', t('回收 环保')],
      ['🅿️', t('停车')],
      ['🏁', t('终点 完赛')],
      ['🚩', t('旗 标记')],
    ],
  },
]

const ALL = EMOJI.flatMap((g) => g.items)
const DEFAULT_RECENT = ['👍', '✅', '🎉', '😄', '🙏', '👀', '🔥', '💪']
// Icon tabs: eight text labels do not fit the panel width.
const CATEGORIES = [
  { value: 'recent' as const, icon: 'clock' as const, 'aria-label': t('常用') },
  ...EMOJI.map((g) => ({ value: g.id, icon: <Emoji char={g.items[0]?.[0] ?? ''} />, 'aria-label': g.label })),
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

/** Emoji panel: search by Chinese keyword, categories, an 8-column grid walked with arrow keys. */
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
