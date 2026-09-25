import type { CSSProperties, ReactNode } from 'react'
import {
  ChatHeader,
  ChatNotice,
  Composer,
  type Conversation,
  ConversationList,
  DocLink,
  FileAttachment,
  Icon,
  ImageAttachment,
  Mention,
  Message,
  MessageActions,
  MessageCard,
  MessageList,
  PinnedBanner,
  Reactions,
  ReadReceipt,
  ThreadSummary,
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

const IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#8ec5ff"/><stop offset="1" stop-color="#c9a7ff"/></linearGradient></defs><rect width="560" height="320" fill="url(#g)"/></svg>',
)}`

function SearchBox() {
  return (
    <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <span style={{ position: 'absolute', left: 9, display: 'grid', color: 'var(--label-secondary)' }}>
        <Icon name="search" size={13} />
      </span>
      <input
        placeholder="搜索"
        aria-label="搜索"
        style={{
          width: '100%',
          height: 'var(--control-regular)',
          border: 0,
          borderRadius: 'var(--radius-capsule)',
          padding: '0 8px 0 28px',
          background: 'var(--control-track)',
          font: 'inherit',
          color: 'var(--label)',
        }}
      />
    </span>
  )
}

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

/** Mirrors docs/design/pane/components/IMExample, with this app's bot messages. */
function IMExample() {
  return (
    <div
      data-testid="im-example"
      style={{
        width: 1040,
        height: 660,
        display: 'flex',
        borderRadius: 'var(--radius-window)',
        boxShadow: 'var(--shadow-window)',
        overflow: 'hidden',
        background: 'var(--window-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--separator)',
          paddingTop: 'var(--toolbar-height)',
        }}
      >
        <ConversationList
          style={{ width: 280, flex: 1 }}
          defaultSelected="a"
          header={<SearchBox />}
          items={CONVERSATIONS}
        />
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
        <ChatHeader
          title="产品设计组"
          group
          subtitle="28 位成员"
          tags={[{ label: '部门', tone: 'gray' }]}
          actions={[
            { icon: 'video', label: '视频会议' },
            { icon: 'search', label: '搜索聊天记录' },
            { icon: 'more', label: '设置' },
          ]}
          tabs={[
            { value: 'chat', label: '聊天' },
            { value: 'doc', label: '云文档' },
            { value: 'file', label: '文件' },
            { value: 'notice', label: '公告' },
          ]}
        />
        <div
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}
        >
          <div style={{ position: 'absolute', top: 10, left: 20, right: 20, zIndex: 3 }}>
            <PinnedBanner
              text="设计评审改到每周四 15:00，评审前一天 18:00 前把稿子链接发到群里。"
              onClose={() => {}}
            />
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <MessageList style={{ paddingTop: 60 }}>
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
            </MessageList>
          </div>
          <div style={{ padding: '8px 16px 16px' }}>
            <Composer recipient="产品设计组" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Dev-only review of the IM primitives against the Pane previews. */
export function IMGallery() {
  return (
    <>
      <section className="gallery__section">
        <h2 className="eyebrow">IM · 示例</h2>
        <div style={{ padding: 28, background: 'var(--window-bg)', borderRadius: 'var(--radius-window)' }}>
          <IMExample />
        </div>
      </section>

      <Card title="ConversationList" style={{ padding: 0, width: 288 }}>
        <ConversationList
          style={{ height: 430, paddingTop: 12 }}
          defaultSelected="b"
          header={<SearchBox />}
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
          <Message author={{ name: 'Codex', bot: true }} time="10:40">
            <p>已修复登录页跳转，改动见下方文件。</p>
            <p>
              运行 <code>pnpm test</code> 全部通过。
            </p>
          </Message>
          <Message author={{ name: 'Codex', bot: true }} continued bare>
            <FileAttachment name="login-redirect.patch" size="4 KB" meta="已下载" />
          </Message>
        </MessageList>
      </Card>

      <Card title="MessageActions · Reactions · ReadReceipt · ThreadSummary">
        <div className="gallery__row" style={{ gap: 20 }}>
          <MessageActions />
          <Reactions
            items={[
              { emoji: '👍', users: ['张三', '李思远'], mine: true },
              { emoji: '🎉', users: ['王小明'] },
            ]}
            onAdd={() => {}}
          />
          <Reactions compact items={[{ emoji: '👀', users: ['张三', '李思远', '王小明'] }]} />
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
        </div>
      </Card>

      <Card title="PinnedBanner" style={{ maxWidth: 640 }}>
        <PinnedBanner
          text="设计评审改到每周四 15:00，评审前一天 18:00 前把稿子链接发到群里。"
          onClose={() => {}}
        />
      </Card>

      <Card title="Composer" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Composer
            recipient="产品设计组"
            replyTo={{ author: 'Mia Chen', text: '新版会话列表的稿子更新了，重点看一下未读徽标和加急态。' }}
            onCancelReply={() => {}}
            defaultValue="收到，下午给结论 "
          />
          <Composer recipient="张三" />
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
