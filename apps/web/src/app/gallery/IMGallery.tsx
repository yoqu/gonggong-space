import type { CSSProperties, ReactNode } from 'react'
import {
  Avatar,
  Badge,
  Button,
  ChatHeader,
  ChatInfoPanel,
  ChatNotice,
  CodeBlock,
  Composer,
  type Conversation,
  ConversationList,
  DocLink,
  EmojiPicker,
  EventCard,
  FileAttachment,
  Icon,
  type IconName,
  ImageAttachment,
  LinkPreview,
  MeetingCard,
  Mention,
  type MentionMember,
  MentionPicker,
  Menu,
  Message,
  MessageActions,
  MessageCard,
  MessageList,
  messageMenuItems,
  PinnedBanner,
  Popover,
  ProfileCard,
  Reactions,
  ReadReceipt,
  SearchField,
  Switch,
  ThreadPanel,
  ThreadSummary,
  TypingIndicator,
  VoiceMessage,
} from '../../ui'

const CONVERSATIONS: Conversation[] = [
  {
    id: 'a',
    name: '产品设计组',
    group: true,
    tags: [{ label: '部门', tone: 'gray' }],
    time: '10:42',
    preview: 'Mia：新版会话列表的稿子更新了',
    unread: 5,
    mention: true,
    pinned: true,
  },
  { id: 'b', name: '张三', status: 'online', time: '10:30', preview: '好的，下午三点会议室见' },
  {
    id: 'c',
    name: 'Codex',
    group: true,
    tags: [{ label: 'Bot', tone: 'blue' }],
    time: '09:58',
    preview: '运行完成：修复登录页跳转',
    unread: 1,
    urgent: true,
  },
  {
    id: 'd',
    name: '星河科技 · 对接群',
    group: true,
    tags: [{ label: '外部', tone: 'orange' }],
    time: '昨天',
    preview: '王总：合同已盖章，请查收',
    unread: 12,
    muted: true,
  },
  { id: 'e', name: '李思远', status: 'busy', time: '星期二', draft: '周报我晚点补上' },
  {
    id: 'f',
    name: '全员通知',
    group: true,
    tags: [{ label: '全员', tone: 'purple' }],
    time: '9月20日',
    preview: '国庆放假安排',
    muted: true,
  },
]

const MEMBERS: MentionMember[] = [
  { name: '张三', pinyin: 'zhangsan', subtitle: '前端', status: 'online' },
  { name: '张晓雯', pinyin: 'zhangxiaowen', subtitle: '设计' },
  { name: '李思远', pinyin: 'lisiyuan', subtitle: '产品', status: 'busy' },
  { name: 'Mia Chen', subtitle: '设计' },
  { name: '王小明', pinyin: 'wangxiaoming', subtitle: '后端' },
]

const PEOPLE = ['Mia Chen', '张三', '李思远', '王小明', '赵六', 'Kevin Liu'].map((name) => ({ name }))

const IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#8ec5ff"/><stop offset="1" stop-color="#c9a7ff"/></linearGradient></defs><rect width="560" height="320" fill="url(#g)"/></svg>',
)}`

const LINK_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#1f4e6b"/><rect x="40" y="40" width="240" height="220" rx="14" fill="#f3d9b1"/><rect x="300" y="40" width="260" height="100" rx="14" fill="#e8743b"/><rect x="300" y="160" width="120" height="100" rx="14" fill="#0088ff"/><rect x="440" y="160" width="120" height="100" rx="50" fill="#f3d9b1"/></svg>',
)}`

const CODE = `const { Message } = window.Pane;

function Reply({ text }) {
  return <Message self author={{ name: 'Yoqu' }}>{text}</Message>;
}`

const ROOT_TEXT = '另外 macOS 27 的侧栏改成贴边了，会话列表要不要也去掉阴影？'

function Card({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section className="gallery__section" data-testid={`im-${title}`}>
      <h2 className="eyebrow">{title}</h2>
      <div
        style={{
          background: 'var(--window-bg)',
          borderRadius: 'var(--radius-window)',
          padding: 28,
          ...style,
        }}
      >
        {children}
      </div>
    </section>
  )
}

const RAIL: { id: string; label: string; icon: IconName; badge?: number; dot?: boolean }[] = [
  { id: 'msg', label: '消息', icon: 'message', badge: 18 },
  { id: 'cal', label: '日历', icon: 'calendar', dot: true },
  { id: 'docs', label: '云文档', icon: 'doc' },
  { id: 'meet', label: '会议', icon: 'video' },
  { id: 'contacts', label: '通讯录', icon: 'contacts' },
  { id: 'apps', label: '工作台', icon: 'apps' },
]

/** Stand-in for NavRail (built in ui/ by another slice), sized like Pane's `.pn-rail`. */
function DemoRail() {
  const item = (it: (typeof RAIL)[number], on = false) => (
    <span
      key={it.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        width: 64,
        fontSize: 'var(--text-footnote-size)',
      }}
    >
      <span
        style={{
          position: 'relative',
          width: 40,
          height: 32,
          borderRadius: 'var(--radius-capsule)',
          display: 'grid',
          placeItems: 'center',
          background: on ? 'var(--tint-blue)' : undefined,
          color: on ? 'var(--tint-blue-text)' : 'var(--label)',
        }}
      >
        <Icon name={it.icon} size={20} />
        {it.badge ? (
          <span style={{ position: 'absolute', top: -7, left: 26 }}>
            <Badge count={it.badge} />
          </span>
        ) : it.dot ? (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 4,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--badge-fill)',
            }}
          />
        ) : null}
      </span>
      <span style={{ color: on ? 'var(--label)' : 'var(--label-secondary)', fontWeight: on ? 600 : 400 }}>
        {it.label}
      </span>
    </span>
  )
  return (
    <div
      style={{
        width: 76,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '52px 0 12px',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--separator)',
        ['--pn-ring' as string]: 'var(--sidebar-bg)',
      }}
    >
      <Avatar name="Yoqu" status="online" size={32} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {RAIL.map((it, i) => item(it, i === 0))}
      </div>
      <div style={{ marginTop: 'auto' }}>{item({ id: 'set', label: '设置', icon: 'gear' })}</div>
    </div>
  )
}

/** Window frame stand-in: rail | sidebar | toolbar + content | inspector (the real Window lives in ui/). */
function DemoWindow({
  width,
  rail,
  sidebar,
  toolbar,
  inspector,
  children,
  testId,
}: {
  width: number
  rail?: ReactNode
  sidebar: ReactNode
  toolbar: ReactNode
  inspector?: ReactNode
  children: ReactNode
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      style={{
        width,
        height: 660,
        display: 'flex',
        borderRadius: 'var(--radius-window)',
        boxShadow: 'var(--shadow-window)',
        overflow: 'hidden',
        background: 'var(--window-bg)',
      }}
    >
      {rail}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--separator)',
          paddingTop: rail ? 14 : 'var(--toolbar-height)',
        }}
      >
        {sidebar}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--content-bg)',
        }}
      >
        {toolbar}
        <div
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}
        >
          {children}
        </div>
      </div>
      {inspector && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderLeft: '1px solid var(--separator)',
          }}
        >
          {inspector}
        </div>
      )}
    </div>
  )
}

const HEADER_ACTIONS: { icon: IconName; label: string }[] = [
  { icon: 'video', label: '视频会议' },
  { icon: 'search', label: '搜索聊天记录' },
  { icon: 'more', label: '设置' },
]

/** Mirrors docs/design/pane/components/IMExample, with this app's bot messages. */
function IMExample() {
  return (
    <DemoWindow
      testId="im-example"
      width={1064}
      rail={<DemoRail />}
      sidebar={
        <ConversationList
          style={{ width: 272, flex: 1 }}
          defaultSelected="a"
          header={<SearchField placeholder="搜索" />}
          items={CONVERSATIONS}
        />
      }
      toolbar={
        <ChatHeader
          title="产品设计组"
          group
          subtitle="28 位成员"
          tags={[{ label: '部门', tone: 'gray' }]}
          actions={HEADER_ACTIONS}
          tabs={[
            { value: 'chat', label: '聊天' },
            { value: 'doc', label: '云文档' },
            { value: 'file', label: '文件' },
            { value: 'notice', label: '公告' },
          ]}
        />
      }
    >
      <div style={{ position: 'absolute', top: 10, left: 20, right: 20, zIndex: 3 }}>
        <PinnedBanner
          text="设计评审改到每周四 15:00，评审前一天 18:00 前把稿子链接发到群里。"
          onClose={() => {}}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <MessageList stickToBottom style={{ paddingTop: 60 }}>
          <ChatNotice kind="date" day="今天">
            10:20
          </ChatNotice>
          <Message
            author={{ name: 'Mia Chen', status: 'online' }}
            time="10:20"
            reactions={[{ emoji: '👍', users: ['张三', '李思远', '王小明'], mine: true }]}
          >
            <p>
              <Mention name="所有人" /> 新版会话列表的稿子更新了，重点看一下未读徽标和加急态。
            </p>
          </Message>
          <Message author={{ name: 'Mia Chen' }} continued bare>
            <DocLink
              kind="doc"
              title="IM 2.0 设计评审纪要"
              owner="Mia Chen"
              updated="今天 10:12 更新"
              permission="群成员可阅读"
            />
          </Message>
          <ChatNotice kind="unread" />
          <Message author={{ name: 'Codex', bot: true }} time="10:28" bare>
            <MessageCard
              template="orange"
              icon="checklist"
              title="需要审批"
              status={{ label: '待审批', tone: 'orange' }}
              fields={[
                { label: '命令', value: 'pnpm install', short: true },
                { label: '权限档位', value: '工作区写入', short: true },
                { label: '工作区', value: '~/code/gonggong' },
              ]}
              actions={[{ label: '允许', variant: 'primary' }, { label: '拒绝' }]}
            />
          </Message>
          <Message
            self
            author={{ name: 'Yoqu' }}
            time="10:31"
            reply={{ author: 'Mia Chen', text: '新版会话列表的稿子更新了' }}
            receipt={{ read: 2, total: 5 }}
            thread={{ count: 3, people: [{ name: '张三' }, { name: '李思远' }], lastTime: '10:36' }}
          >
            <p>
              收到，
              <Mention name="张三" /> 帮忙看下交互细节
            </p>
          </Message>
          <Message author={{ name: 'Mia Chen' }} time="10:40" bare>
            <MeetingCard
              status="live"
              title="IM 2.0 设计评审"
              time="10:40 开始"
              meetingId="628 331 907"
              host="Mia Chen"
              participants={PEOPLE.slice(0, 5)}
              joined={4}
            />
          </Message>
          <div style={{ paddingLeft: 42 }}>
            <TypingIndicator name="张三" />
          </div>
        </MessageList>
      </div>
      <div style={{ padding: '8px 16px 16px' }}>
        <Composer recipient="产品设计组" mentions={MEMBERS} />
      </div>
    </DemoWindow>
  )
}

/** Mirrors docs/design/pane/components/IMThreadExample: ThreadPanel docked as the inspector. */
function IMThreadExample() {
  return (
    <DemoWindow
      testId="im-thread-example"
      width={1144}
      sidebar={
        <ConversationList
          style={{ width: 260, flex: 1 }}
          defaultSelected="a"
          header={<SearchField placeholder="搜索" />}
          items={[
            {
              ...(CONVERSATIONS[0] as Conversation),
              preview: '张三：同意，阴影在贴边以后就没意义了。',
              unread: 0,
              mention: false,
            },
            ...CONVERSATIONS.slice(1, 4),
          ]}
        />
      }
      toolbar={
        <ChatHeader
          title="产品设计组"
          group
          subtitle={<TypingIndicator name="李思远" bubble={false} />}
          actions={HEADER_ACTIONS}
        />
      }
      inspector={
        <ThreadPanel
          subtitle="产品设计组"
          onClose={() => {}}
          root={
            <Message author={{ name: 'Mia Chen', status: 'online' }} time="今天 10:21" actions={false}>
              {ROOT_TEXT}
            </Message>
          }
          composerProps={{ recipient: '话题', mentions: MEMBERS }}
        >
          <Message author={{ name: '张三' }} time="10:24">
            同意，阴影在贴边以后就没意义了。
          </Message>
          <Message author={{ name: '李思远', status: 'busy' }} time="10:30">
            选中态用 selection-fill 的胶囊，和 Finder 侧栏一致。
          </Message>
        </ThreadPanel>
      }
    >
      <div style={{ flex: 1, overflow: 'auto' }}>
        <MessageList>
          <ChatNotice kind="date" day="今天">
            10:20
          </ChatNotice>
          <Message
            author={{ name: 'Mia Chen', status: 'online' }}
            time="10:21"
            thread={{ count: 2, people: [{ name: '张三' }, { name: '李思远' }], lastTime: '10:30' }}
          >
            {ROOT_TEXT}
          </Message>
          <Message author={{ name: '张三' }} time="10:33" bare>
            <FileAttachment name="会话列表-v3.fig" size="18.4 MB" />
          </Message>
          <Message self author={{ name: 'Yoqu' }} time="10:35" receipt={{ read: 3, total: 28 }}>
            <VoiceMessage duration={9} played seed="x" />
          </Message>
        </MessageList>
      </div>
      <div style={{ padding: '8px 16px 16px' }}>
        <Composer recipient="产品设计组" mentions={MEMBERS} />
      </div>
    </DemoWindow>
  )
}

/** Dev-only review of the IM components against the Pane previews. */
export function IMGallery() {
  return (
    <>
      <section className="gallery__section">
        <h2 className="eyebrow">IM · 示例</h2>
        <div style={{ padding: 28, background: 'var(--window-bg)', borderRadius: 'var(--radius-window)' }}>
          <IMExample />
        </div>
      </section>

      <section className="gallery__section">
        <h2 className="eyebrow">IM · 话题示例</h2>
        <div style={{ padding: 28, background: 'var(--window-bg)', borderRadius: 'var(--radius-window)' }}>
          <IMThreadExample />
        </div>
      </section>

      <Card title="ConversationList" style={{ padding: 0, width: 288 }}>
        <ConversationList
          style={{ height: 430, paddingTop: 12 }}
          defaultSelected="b"
          header={<SearchField placeholder="搜索" />}
          items={CONVERSATIONS}
        />
      </Card>

      <Card title="ChatHeader" style={{ padding: 0 }}>
        <ChatHeader
          title="产品设计组"
          group
          subtitle="28 位成员 · 设计评审每周四 15:00"
          tags={[{ label: '部门', tone: 'gray' }]}
          actions={[
            { icon: 'video', label: '视频会议' },
            { icon: 'search', label: '搜索聊天记录' },
            { icon: 'person-add', label: '添加成员' },
            { icon: 'more', label: '设置' },
          ]}
          tabs={[
            { value: 'chat', label: '聊天' },
            { value: 'doc', label: '云文档' },
            { value: 'pin', label: 'Pin' },
            { value: 'file', label: '文件' },
            { value: 'notice', label: '公告' },
          ]}
        />
        <ChatHeader title="张三" subtitle={<TypingIndicator name="张三" bubble={false} />} />
      </Card>

      <Card title="Message" style={{ padding: 0, background: 'var(--content-bg)' }}>
        <MessageList style={{ padding: '28px 20px 20px' }}>
          <ChatNotice kind="date" day="今天">
            10:20
          </ChatNotice>
          <Message
            author={{ name: 'Mia Chen', status: 'online' }}
            time="10:20"
            reactions={[
              { emoji: '👍', users: ['张三', '李思远', '王小明', '赵六'], mine: true },
              { emoji: '🎉', users: ['张三'] },
            ]}
          >
            <p>
              <Mention name="所有人" /> 新版会话列表的稿子更新了，重点看一下未读徽标和加急态。链接：
              <a href="#figma">Figma · IM 2.0</a>
            </p>
          </Message>
          <Message
            author={{ name: 'Mia Chen' }}
            continued
            thread={{ count: 3, people: [{ name: '张三' }, { name: '李思远' }], lastTime: '10:36' }}
          >
            另外 macOS 27 的侧栏改成贴边了，列表也跟着去掉阴影。
          </Message>
          <Message
            self
            author={{ name: 'Yoqu' }}
            time="10:31"
            reply={{ author: 'Mia Chen', text: '新版会话列表的稿子更新了，重点看一下未读徽标和加急态。' }}
            receipt={{ read: 2, total: 5 }}
            showActions
          >
            <p>
              收到，
              <Mention name="张三" /> 帮忙看下交互细节
            </p>
          </Message>
          <Message author={{ name: '张三', tags: [{ label: '外部', tone: 'orange' }] }} time="10:33" urgent>
            <p>
              <Mention name="Yoqu" me /> 这版今天下班前需要确认，客户明早要看。
            </p>
          </Message>
          <Message self author={{ name: 'Yoqu' }} time="10:34" receipt={{ read: 1, total: 1 }}>
            好，我下午 3 点前给结论。
          </Message>
          <Message self author={{ name: 'Yoqu' }} continued status="failed" onRetry={() => {}}>
            附上上周的评审纪要
          </Message>
          <Message self author={{ name: 'Yoqu' }} continued status="sending" edited>
            正在发送的消息
          </Message>
          <ChatNotice kind="recalled" action={{ label: '重新编辑' }} />
          <Message author={{ name: 'Codex', bot: true }} time="10:40">
            <p>已修复登录页跳转，改动见下方文件。</p>
            <p>
              运行 <code>pnpm test</code> 全部通过。
            </p>
          </Message>
          <Message author={{ name: 'Codex', bot: true }} continued bare>
            <FileAttachment name="login-redirect.patch" size="4 KB" meta="已下载" />
          </Message>
          <div style={{ paddingLeft: 42 }}>
            <TypingIndicator name={['Mia Chen', '李思远', '王小明']} />
          </div>
        </MessageList>
      </Card>

      <Card title="MessageActions · Reactions · ReadReceipt · ThreadSummary" style={{ paddingTop: 320 }}>
        <div className="gallery__row" style={{ gap: 20 }}>
          <MessageActions />
          <Reactions
            addable
            defaultPickerOpen
            items={[
              { emoji: '👍', users: ['张三', '李思远', '王小明', '赵六'], mine: true },
              { emoji: '✅', users: ['Mia Chen'] },
              { emoji: '👀', users: ['王小明', '赵六'] },
            ]}
          />
          <Reactions
            compact
            items={[{ emoji: '👀', users: ['张三', '李思远', '王小明'] }]}
            onAdd={() => {}}
          />
          <ReadReceipt read={0} total={5} />
          <ReadReceipt read={2} total={5} />
          <ReadReceipt read={5} total={5} />
          <ThreadSummary count={3} people={[{ name: '张三' }, { name: '李思远' }]} lastTime="10:36" />
        </div>
      </Card>

      <Card title="ChatNotice">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ChatNotice kind="date" day="昨天">
            18:20
          </ChatNotice>
          <ChatNotice>张三 邀请 Mia Chen、王小明 加入了群</ChatNotice>
          <ChatNotice kind="unread" />
          <ChatNotice kind="urgent">张三 对你发起了应用内加急</ChatNotice>
          <ChatNotice kind="recalled" action={{ label: '重新编辑' }} />
        </div>
      </Card>

      <Card title="PinnedBanner" style={{ maxWidth: 640 }}>
        <PinnedBanner
          text="设计评审改到每周四 15:00，评审前一天 18:00 前把稿子链接发到群里。"
          onClose={() => {}}
        />
      </Card>

      <Card title="Composer" style={{ maxWidth: 640, paddingTop: 300 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Composer
            recipient="产品设计组"
            mentions={MEMBERS}
            defaultMentionOpen
            defaultValue="这版交互请 @张"
          />
          <Composer
            recipient="产品设计组"
            replyTo={{ author: 'Mia Chen', text: '新版会话列表的稿子更新了，重点看一下未读徽标和加急态。' }}
            onCancelReply={() => {}}
            defaultValue="收到，下午给结论 "
          />
          <Composer recipient="张三" />
        </div>
      </Card>

      <Card title="MentionPicker · EmojiPicker">
        <div className="gallery__row" style={{ alignItems: 'flex-start', gap: 24 }}>
          <MentionPicker members={MEMBERS} activeIndex={1} />
          <MentionPicker members={MEMBERS} query="张" />
          <EmojiPicker />
          <EmojiPicker defaultCategory="hand" />
        </div>
      </Card>

      <Card title="Popover · ProfileCard" style={{ minHeight: 340 }}>
        <Popover defaultOpen aria-label="张三 的名片" trigger={<Button variant="plain">@张三</Button>}>
          <ProfileCard
            name="张三"
            status="busy"
            statusText="会议中 · 至 11:00"
            title="前端工程师 · 数字化转型部"
            tags={[{ label: '外部', tone: 'orange' }]}
            fields={[
              { label: '邮箱', value: 'zhangsan@example.com' },
              { label: '城市', value: '深圳' },
              { label: '本地时间', value: '10:42（GMT+8）' },
            ]}
            actions={[
              { label: '发消息', icon: 'bubble' },
              { label: '语音通话', icon: 'phone', text: false },
              { label: '视频会议', icon: 'video', text: false },
            ]}
          />
        </Popover>
      </Card>

      <Card title="messageMenuItems" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <Menu
          items={messageMenuItems({ self: true })}
          activeValue="thread"
          onSelect={() => {}}
          style={{ minWidth: 200 }}
        />
        <Menu items={messageMenuItems()} onSelect={() => {}} style={{ minWidth: 200 }} />
      </Card>

      <Card
        title="CodeBlock · LinkPreview · VoiceMessage"
        style={{ padding: 0, background: 'var(--content-bg)' }}
      >
        <MessageList style={{ padding: '20px' }}>
          <Message self author={{ name: 'Yoqu' }} time="10:50" actions={false}>
            <p>
              组件这样用，注意 <code>self</code> 属性：
            </p>
            <CodeBlock language="JSX" code={CODE} />
          </Message>
          <Message author={{ name: 'Mia Chen' }} time="10:12" actions={false}>
            <p>
              参考一下这篇：<a href="#link">https://design.example.com/liquid-glass</a>
            </p>
            <LinkPreview
              url="https://design.example.com/liquid-glass"
              site="design.example.com"
              title="Liquid Glass 的可读性修正：从 Tahoe 到 Golden Gate"
              description="macOS 27 调整了玻璃的不透明度、边缘加深和高光，本文逐项对比两代系统的截图。"
              image={LINK_IMAGE}
            />
          </Message>
          <Message author={{ name: '张三' }} time="10:40" actions={false}>
            <VoiceMessage duration={12} seed="a" />
          </Message>
          <Message
            self
            author={{ name: 'Yoqu' }}
            time="10:41"
            actions={false}
            receipt={{ read: 1, total: 1 }}
          >
            <VoiceMessage
              duration={34}
              played
              playing
              seed="b"
              transcript="评审我改到周四下午三点，材料今晚发群里。"
            />
          </Message>
        </MessageList>
      </Card>

      <Card title="TypingIndicator">
        <div className="gallery__row" style={{ gap: 32 }}>
          <TypingIndicator name="张三" />
          <TypingIndicator name={['Mia Chen', '李思远', '王小明']} />
          <TypingIndicator name="张三" bubble={false} />
        </div>
      </Card>

      <Card title="MeetingCard · EventCard">
        <div className="gallery__row" style={{ alignItems: 'flex-start' }}>
          <MeetingCard
            status="live"
            title="IM 2.0 设计评审"
            time="10:30 开始"
            meetingId="628 331 907"
            host="Mia Chen"
            participants={PEOPLE}
            joined={5}
          />
          <MeetingCard
            status="ended"
            title="周例会"
            time="昨天 15:00 – 15:45"
            duration="45 分钟"
            host="张三"
            participants={PEOPLE}
            onReplay={() => {}}
          />
          <MeetingCard
            status="scheduled"
            startsIn="5 分钟后开始"
            title="需求评审"
            time="11:00 – 11:30"
            participants={PEOPLE.slice(0, 3)}
          />
          <EventCard
            title="IM 2.0 设计评审"
            month="10月"
            day={8}
            weekday="星期四"
            time="10月8日 15:00 – 16:00"
            location="深圳 · 7F 金门会议室"
            organizer="Mia Chen"
            attendees={12}
          />
          <EventCard
            title="国庆后产品规划会"
            month="10月"
            day={9}
            weekday="星期五"
            time="10月9日 10:00 – 11:30"
            location="线上 · 视频会议"
            organizer="张三"
            defaultRsvp="accepted"
          />
        </div>
      </Card>

      <Card
        title="ChatInfoPanel · ThreadPanel"
        style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}
      >
        <div style={{ height: 680, width: 300, borderLeft: '1px solid var(--separator)' }}>
          <ChatInfoPanel
            onClose={() => {}}
            name="产品设计组"
            tags={[{ label: '部门', tone: 'gray' }]}
            description="IM 2.0 设计与评审，每周四 15:00 例会"
            shortcuts={[
              { icon: 'search', label: '搜索' },
              { icon: 'folder', label: '文件' },
              { icon: 'pin', label: 'Pin' },
              { icon: 'megaphone', label: '公告' },
            ]}
            memberCount={28}
            onAddMember={() => {}}
            onShowAllMembers={() => {}}
            members={[
              { name: 'Mia Chen', status: 'online' },
              { name: '张三' },
              { name: '李思远', status: 'busy' },
              { name: '王小明' },
              { name: '赵六' },
              { name: 'Kevin Liu' },
              { name: '周颖' },
              { name: '陈晨' },
              { name: '孙悦' },
            ]}
            settings={[
              { label: '消息免打扰', control: <Switch aria-label="消息免打扰" /> },
              { label: '置顶聊天', control: <Switch defaultChecked aria-label="置顶聊天" /> },
              { label: '我在本群的昵称', value: 'Yoqu', onClick: () => {} },
              { label: '群公告', value: '设计评审改到每周四…', onClick: () => {} },
            ]}
            danger={{ label: '退出群' }}
          />
        </div>
        <div style={{ height: 620, width: 360, borderLeft: '1px solid var(--separator)' }}>
          <ThreadPanel
            subtitle="产品设计组"
            onClose={() => {}}
            root={
              <Message author={{ name: 'Mia Chen', status: 'online' }} time="今天 10:21" actions={false}>
                {ROOT_TEXT}
              </Message>
            }
            composerProps={{ recipient: '话题' }}
          >
            <Message author={{ name: '张三' }} time="10:24">
              同意，阴影在贴边以后就没意义了。
            </Message>
            <Message
              author={{ name: '李思远', status: 'busy' }}
              time="10:30"
              reactions={[{ emoji: '👍', users: ['Mia Chen'] }]}
            >
              选中态可以用 selection-fill 的胶囊，和 Finder 侧栏一致。
            </Message>
            <Message self author={{ name: 'Yoqu' }} time="10:36" receipt={{ read: 3, total: 3 }}>
              好，那就按这个改，我今天更新到组件库。
            </Message>
          </ThreadPanel>
        </div>
      </Card>

      <Card title="MessageCard">
        <div className="gallery__row" style={{ alignItems: 'flex-start' }}>
          <MessageCard
            template="orange"
            icon="checklist"
            title="请假申请"
            status={{ label: '待审批', tone: 'orange' }}
            fields={[
              { label: '申请人', value: '李思远', short: true },
              { label: '类型', value: '年假', short: true },
              { label: '时间', value: '10月8日 – 10月10日，共 3 天' },
              { label: '事由', value: '国庆后返乡处理家事' },
            ]}
            actions={[
              { label: '同意', variant: 'primary' },
              { label: '拒绝' },
              { label: '转交…', variant: 'plain' },
            ]}
          />
          <MessageCard
            template="green"
            icon="check"
            title="发布成功"
            status={{ label: '已完成', tone: 'green' }}
            fields={[
              { label: '版本', value: 'v2.8.0', short: true },
              { label: '环境', value: '生产', short: true },
            ]}
            note="由 CI 流水线于 10:05 发送"
          />
        </div>
      </Card>

      <Card title="FileAttachment · ImageAttachment · DocLink">
        <div className="gallery__row" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FileAttachment name="2026 Q3 经营分析报告.pdf" size="3.2 MB" />
            <FileAttachment name="IM 2.0 交互稿.pptx" size="18.4 MB" meta="正在上传" progress={62} />
            <FileAttachment name="客户名单.xlsx" size="820 KB" meta="已下载" onDownload={false} />
          </div>
          <ImageAttachment src={IMAGE} alt="渐变示意图" width={280} height={160} />
          <DocLink
            kind="sheet"
            title="IM 2.0 需求排期"
            owner="Mia Chen"
            updated="昨天 18:02 更新"
            permission="你有可编辑权限"
          />
        </div>
      </Card>
    </>
  )
}
