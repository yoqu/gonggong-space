import { type CSSProperties, type ReactNode, useState } from 'react'
import {
  AlertDialog,
  AlertPanel,
  AppFrame,
  Avatar,
  Button,
  ChatHeader,
  Checkbox,
  Composer,
  ContextMenu,
  type Conversation,
  ConversationList,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  HUD,
  Icon,
  Menu,
  MenuButton,
  type MenuItem,
  Message,
  MessageList,
  NavRail,
  NotificationBanner,
  Popover,
  PopUpButton,
  RadioGroup,
  SearchField,
  Sheet,
  Sidebar,
  Switch,
  TabView,
  TextField,
  Toast,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  Tooltip,
  toast,
  Window,
} from '../../ui'

/** Pane `pn-desktop` wallpaper, so glass samples show what they blur. */
const WALLPAPER =
  'radial-gradient(120% 90% at 85% 10%, var(--wallpaper-1) 0%, transparent 55%), radial-gradient(90% 80% at 10% 100%, var(--wallpaper-2) 0%, transparent 60%), var(--wallpaper-3)'

const MENU: MenuItem[] = [
  { label: '打开', value: 'open', shortcut: '⌘O' },
  { label: '在新标签页中打开', value: 'tab' },
  { separator: true },
  { label: '显示简介', value: 'info', shortcut: '⌘I' },
  { label: '重新命名', value: 'rename' },
  { label: '复制', value: 'dup', shortcut: '⌘D' },
  {
    label: '共享',
    value: 'share',
    submenu: [
      { label: '隔空投送', value: 'airdrop' },
      { label: '信息', value: 'msg' },
      { label: '邮件', value: 'mail' },
      { separator: true },
      { label: '拷贝链接', value: 'link' },
    ],
  },
  { separator: true },
  { header: '显示方式' },
  { label: '图标', value: 'icons', checked: true },
  { label: '列表', value: 'list', checked: false },
  { separator: true },
  { label: '移到废纸篓', value: 'trash', shortcut: '⌘⌫', destructive: true },
]

/** Same entries as Pane `messageMenuItems({ self: true })`; the IM helper itself lives in ui/im. */
const MESSAGE_MENU: MenuItem[] = [
  { label: '回复', value: 'reply', icon: 'reply' },
  { label: '回复话题', value: 'thread', icon: 'thread' },
  { label: '转发', value: 'forward', icon: 'forward' },
  { separator: true },
  { label: '拷贝', value: 'copy', shortcut: '⌘C' },
  { label: '置顶', value: 'pin' },
  { label: '标记为待办', value: 'todo' },
  { label: '多选', value: 'select' },
  { separator: true },
  { label: '编辑', value: 'edit' },
  { label: '撤回', value: 'recall', destructive: true },
]

const RAIL = [
  { id: 'msg', label: '消息', icon: 'message' as const, badge: 18 },
  { id: 'cal', label: '日历', icon: 'calendar' as const, dot: true },
  { id: 'docs', label: '云文档', icon: 'doc' as const },
  { id: 'meet', label: '会议', icon: 'video' as const },
  { id: 'contacts', label: '通讯录', icon: 'contacts' as const },
  { id: 'apps', label: '工作台', icon: 'apps' as const },
]

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
  { id: 'e', name: '李思远', status: 'busy', time: '星期二', draft: '周报我晚点补上' },
]

/** One Pane preview card: `bg` and `padding` match the component's preview.html body. */
function Card({
  id,
  title,
  bg = 'var(--window-bg)',
  padding = 20,
  style,
  children,
}: {
  id: string
  title: string
  bg?: string
  padding?: CSSProperties['padding']
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <section className="gallery__section" data-testid={`gallery-${id}`}>
      <h2 className="eyebrow">{title}</h2>
      <div data-card={id} style={{ background: bg, padding, borderRadius: 'var(--radius-menu)', ...style }}>
        {children}
      </div>
    </section>
  )
}

const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }

/** Vc menus, overlays and window structure, each laid out like its Pane v2 preview card. */
export function OverlayGallery() {
  const [alert, setAlert] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [tab, setTab] = useState('g')
  return (
    <>
      <Card
        id="menu"
        bg={WALLPAPER}
        title="MENU · MENUBUTTON"
        style={{ minHeight: 270, display: 'flex', gap: 40 }}
      >
        <Menu
          aria-label="文件"
          style={{ width: 240 }}
          activeValue="share"
          defaultOpenSubmenu={6}
          items={MENU}
        />
        <div style={{ marginLeft: 220 }}>
          <MenuButton
            className="ui-btn"
            aria-label="更多"
            items={MENU}
            onSelect={(v) => toast({ message: `已选择 ${v}` })}
          >
            <Icon name="more" />
          </MenuButton>
        </div>
      </Card>

      <Card id="context-menu" title="CONTEXTMENU" bg="var(--content-bg)" style={{ minHeight: 340 }}>
        <ContextMenu items={MESSAGE_MENU} defaultPosition={{ x: 300, y: 40 }} activeValue="thread">
          <MessageList style={{ padding: '8px 0' }}>
            <Message
              self
              author={{ name: 'Yoqu' }}
              time="10:34"
              receipt={{ read: 1, total: 1 }}
              actions={false}
            >
              好，我下午 3 点前给结论。
            </Message>
          </MessageList>
        </ContextMenu>
      </Card>

      <Card id="popover" bg={WALLPAPER} title="POPOVER">
        <div style={{ ...row, gap: 32, alignItems: 'flex-start', minHeight: 310 }}>
          <Popover
            defaultOpen
            aria-label="张三 的名片"
            width={300}
            trigger={<Button variant="plain">@张三</Button>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Avatar name="张三" size={48} status="busy" />
                <div>
                  <div style={{ fontSize: 'var(--text-title-3-size)', fontWeight: 700 }}>张三</div>
                  <div style={{ fontSize: 'var(--text-subheadline-size)', color: 'var(--label-secondary)' }}>
                    会议中 · 至 11:00
                  </div>
                </div>
              </div>
              <GroupBox>
                <GroupRow label="邮箱">zhangsan@example.com</GroupRow>
                <GroupRow label="城市">深圳</GroupRow>
              </GroupBox>
              <Button variant="primary" icon="bubble">
                发消息
              </Button>
            </div>
          </Popover>
          <Popover arrow trigger={<Button>筛选…</Button>} placement="bottom-start">
            <Checkbox label="只看未读" defaultChecked />
          </Popover>
        </div>
      </Card>

      <Card id="tooltip" bg={WALLPAPER} title="TOOLTIP">
        <div style={{ ...row, gap: 28, padding: '40px 0 0 60px' }}>
          <Tooltip content="新建群组" shortcut="⌘N" defaultOpen>
            <Button icon="person-add" aria-label="新建群组" />
          </Tooltip>
          <Tooltip content="在新窗口中打开这个会话，方便对照查看">
            <Button>悬停查看</Button>
          </Tooltip>
          <Tooltip content="拷贝链接" placement="bottom">
            <Button variant="glass" icon="link" aria-label="拷贝链接" />
          </Tooltip>
        </div>
      </Card>

      <Card id="sheet" bg={WALLPAPER} title="SHEET" padding={28}>
        <Window
          title="消息"
          height={460}
          toolbar={
            <Toolbar title="通讯录" subtitle="128 位联系人" scrolled={false}>
              <ToolbarGroup>
                <ToolbarButton icon="person-add" label="新建群组" onClick={() => setSheet(true)} />
              </ToolbarGroup>
            </Toolbar>
          }
        >
          <EmptyState title="选择一位联系人" description="或点工具栏的按钮新建群组。" />
          <Sheet
            open
            trapFocus={false}
            title="新建群组"
            message="群组创建后，你可以在群设置里修改这些信息。"
            footer={<Button variant="plain">了解群组类型…</Button>}
            actions={[{ label: '取消' }, { label: '创建', variant: 'primary' }]}
          >
            <TextField label="群名称" defaultValue="IM 2.0 设计评审" />
            <RadioGroup
              aria-label="群类型"
              direction="row"
              defaultValue="dept"
              options={[
                { value: 'dept', label: '部门群' },
                { value: 'project', label: '项目群' },
                { value: 'ext', label: '外部群' },
              ]}
            />
            <Checkbox label="允许新成员查看历史消息" defaultChecked />
          </Sheet>
        </Window>
        <AppFrame style={{ marginTop: 16, height: 300, borderRadius: 'var(--radius-window)' }}>
          <div style={{ padding: 20 }}>
            <Button onClick={() => setSheet(true)}>新建群组…</Button>
          </div>
          <Sheet
            open={sheet}
            onClose={() => setSheet(false)}
            title="新建群组"
            actions={[
              { label: '取消', onClick: () => setSheet(false) },
              { label: '创建', variant: 'primary', onClick: () => setSheet(false) },
            ]}
          >
            <TextField label="群名称" />
          </Sheet>
        </AppFrame>
      </Card>

      <Card id="dialog" title="DIALOG" bg="var(--content-bg)">
        <div
          style={{
            position: 'relative',
            height: 300,
            borderRadius: 'var(--radius-menu)',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, background: WALLPAPER }} />
          <Dialog
            open
            contained
            bare
            role="alertdialog"
            aria-label="删除确认"
            trapFocus={false}
            onClose={() => {}}
          >
            <AlertPanel
              icon={<Icon name="warning" size={48} color="var(--system-orange)" />}
              title="要删除「IM 2.0 设计评审」群组吗？"
              message="所有成员都会被移出，聊天记录无法恢复。"
              actions={[{ label: '取消' }, { label: '删除', variant: 'destructive' }]}
            />
          </Dialog>
        </div>
        <div style={{ ...row, marginTop: 12 }}>
          <Button onClick={() => setDialog(true)}>打开 Dialog</Button>
          <Button onClick={() => setAlert(true)}>打开 AlertDialog</Button>
        </div>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="要离开「前端」群吗？"
          message="离开后不再接收该群的消息，可以随时被重新邀请。"
          actions={[
            { label: '取消', onClick: () => setDialog(false) },
            { label: '离开', variant: 'primary', onClick: () => setDialog(false), autoFocus: true },
          ]}
        />
        <AlertDialog
          open={alert}
          onClose={() => setAlert(false)}
          title="要移除「前端」群中的 Bot 吗？"
          message="Bot 将停止接收该群的消息，可以随时重新添加。"
          actions={[
            { label: '取消', onClick: () => setAlert(false) },
            { label: '移除', variant: 'destructive', onClick: () => setAlert(false) },
          ]}
        />
      </Card>

      <Card id="alert" bg={WALLPAPER} title="ALERT" padding={24} style={{ minHeight: 330 }}>
        <div style={{ ...row, justifyContent: 'center', gap: 24, alignItems: 'flex-start' }}>
          <AlertPanel
            icon={<Icon name="warning" size={48} color="var(--system-orange)" />}
            title="要将「季度报告」移到废纸篓吗？"
            message="此项目将被立即删除，此操作无法撤销。"
            suppression="不再询问"
            actions={[{ label: '取消' }, { label: '删除', variant: 'destructive' }]}
          />
          <AlertPanel
            title="要保存对文稿的更改吗？"
            message="如果不保存，你的更改将丢失。"
            actions={[{ label: '保存', variant: 'primary' }, { label: '不保存' }, { label: '取消' }]}
          />
        </div>
      </Card>

      <Card id="toast" bg={WALLPAPER} title="TOAST · HUD">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ ...row, gap: 16, justifyContent: 'center' }}>
            <Toast icon="check" message="已拷贝链接" />
            <Toast icon="trash" message="已删除 3 条消息" action={{ label: '撤销' }} />
          </div>
          <div style={{ ...row, gap: 16 }}>
            <HUD icon="speaker" level={0.6} />
            <HUD icon="check" title="已保存到「文稿」" />
          </div>
          <div style={row}>
            <Button onClick={() => toast({ type: 'success', message: '已拷贝链接' })}>toast()</Button>
            <Button
              onClick={() => toast({ type: 'error', title: '发送失败', message: '网络连接失败，请重试' })}
            >
              toast(error)
            </Button>
          </div>
        </div>
      </Card>

      <Card id="notification" bg={WALLPAPER} title="NOTIFICATIONBANNER" padding={24}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 }}>
          <NotificationBanner
            onClose={() => {}}
            avatar={{ name: 'Mia Chen' }}
            title="Mia Chen"
            subtitle="产品设计组"
            body="@Yoqu 新版会话列表的稿子更新了，重点看一下未读徽标和加急态。"
            time="现在"
            actions={[{ label: '回复' }, { label: '标为已读' }]}
          />
          <NotificationBanner
            avatar={{ name: '审批', shape: 'square' }}
            title="审批"
            body="李思远 提交的请假申请待你审批（10月8日 – 10月10日）"
            time="2 分钟前"
            stacked={3}
          />
        </div>
      </Card>

      <Card id="nav-rail" title="NAVRAIL" bg="var(--sidebar-bg)" padding="12px 0 0">
        <div style={{ display: 'flex', height: 440, width: 76, borderRight: '1px solid var(--separator)' }}>
          <NavRail
            avatar={{ name: 'Yoqu', status: 'online' }}
            defaultSelected="msg"
            items={RAIL}
            footer={[{ id: 'set', label: '设置', icon: 'gear' }]}
          />
        </div>
      </Card>

      <Card id="window" bg={WALLPAPER} title="WINDOW" padding={28} style={{ minHeight: 440 }}>
        <Window
          title="文稿"
          width="100%"
          height={380}
          sidebar={
            <Sidebar
              defaultSelected="docs"
              sections={[
                {
                  title: '个人收藏',
                  items: [
                    { id: 'recents', label: '最近使用', icon: 'clock', color: 'var(--system-blue)' },
                    { id: 'docs', label: '文稿', icon: 'doc', color: 'var(--system-orange)' },
                    { id: 'dl', label: '下载', icon: 'download', color: 'var(--system-green)' },
                  ],
                },
                {
                  title: '位置',
                  items: [{ id: 'icloud', label: 'iCloud 云盘', icon: 'cloud', color: 'var(--system-cyan)' }],
                },
              ]}
            />
          }
          toolbar={
            <Toolbar title="文稿" subtitle="3 项" scrolled={false}>
              <ToolbarGroup>
                <ToolbarButton icon="grid" label="图标" active />
                <ToolbarButton icon="list" label="列表" />
              </ToolbarGroup>
              <ToolbarGroup>
                <ToolbarButton icon="share" label="共享" />
              </ToolbarGroup>
              <SearchField style={{ minWidth: 140 }} />
            </Toolbar>
          }
        >
          <GroupBox>
            <GroupRow label="季度报告.pages" description="今天 09:41">
              <Icon name="doc" color="var(--system-orange)" />
            </GroupRow>
            <GroupRow label="预算.numbers" description="昨天">
              <Icon name="doc" color="var(--system-green)" />
            </GroupRow>
            <GroupRow label="发布会.key" description="9月20日">
              <Icon name="doc" color="var(--system-blue)" />
            </GroupRow>
          </GroupBox>
        </Window>
      </Card>

      <Card id="toolbar" title="TOOLBAR">
        <div
          style={{
            borderRadius: 'var(--radius-menu)',
            overflow: 'hidden',
            background: 'var(--content-bg)',
            boxShadow: '0 0 0 1px var(--separator)',
          }}
        >
          <Toolbar title="文稿" subtitle="24 项" scrolled={false}>
            <ToolbarGroup>
              <ToolbarButton icon="chevron-left" label="后退" />
              <ToolbarButton icon="chevron-right" label="前进" />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarButton icon="grid" label="图标" active />
              <ToolbarButton icon="list" label="列表" />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarButton icon="share" label="共享" />
              <ToolbarButton icon="tag" label="标签" />
            </ToolbarGroup>
            <SearchField style={{ minWidth: 160 }} />
          </Toolbar>
        </div>
      </Card>

      <Card id="sidebar" title="SIDEBAR" bg="var(--content-bg)" padding={0}>
        <div style={{ display: 'flex', gap: 24 }}>
          <Sidebar
            style={{ height: 370 }}
            defaultSelected="q3"
            defaultExpanded={['docs', 'reports']}
            defaultCollapsed={['标签']}
            sections={[
              {
                title: '个人收藏',
                collapsible: true,
                items: [
                  { id: 'recents', label: '最近使用', icon: 'clock', color: 'var(--system-blue)' },
                  { id: 'desktop', label: '桌面', icon: 'desktop', color: 'var(--system-indigo)' },
                  {
                    id: 'docs',
                    label: '文稿',
                    icon: 'folder',
                    color: 'var(--system-orange)',
                    children: [
                      {
                        id: 'reports',
                        label: '报告',
                        icon: 'folder',
                        color: 'var(--system-orange)',
                        children: [
                          { id: 'q3', label: '2026 Q3', icon: 'doc', color: 'var(--label-secondary)' },
                          { id: 'q2', label: '2026 Q2', icon: 'doc', color: 'var(--label-secondary)' },
                        ],
                      },
                      { id: 'drafts', label: '草稿', icon: 'folder', color: 'var(--system-orange)' },
                    ],
                  },
                  { id: 'dl', label: '下载', icon: 'download', color: 'var(--system-green)', badge: 3 },
                ],
              },
              {
                title: '位置',
                collapsible: true,
                items: [{ id: 'icloud', label: 'iCloud 云盘', icon: 'cloud', color: 'var(--system-cyan)' }],
              },
              {
                title: '标签',
                collapsible: true,
                items: [{ id: 'fav', label: '重要', icon: 'star', color: 'var(--system-yellow)' }],
              },
            ]}
          />
          <Sidebar
            style={{ height: 370 }}
            iconStyle="tile"
            defaultSelected="wifi"
            sections={[
              {
                items: [
                  { id: 'wifi', label: '无线局域网', icon: 'wifi', color: 'var(--system-blue)' },
                  { id: 'bell', label: '通知', icon: 'bell', color: 'var(--system-red)' },
                  { id: 'lock', label: '隐私与安全性', icon: 'lock', color: 'var(--system-indigo)' },
                  { id: 'gear', label: '通用', icon: 'gear', color: 'var(--system-gray)' },
                ],
              },
            ]}
          />
        </div>
      </Card>

      <Card id="tab-view" title="TABVIEW" style={{ minHeight: 220 }}>
        <TabView
          value={tab}
          onChange={setTab}
          tabs={[
            {
              value: 'g',
              label: '通用',
              content: (
                <GroupBox>
                  <GroupRow label="启动时打开">
                    <Switch defaultChecked ariaLabel="启动时打开" />
                  </GroupRow>
                  <GroupRow label="默认浏览器">
                    <PopUpButton
                      options={[
                        { value: 's', label: 'Safari' },
                        { value: 'o', label: '其他' },
                      ]}
                      defaultValue="s"
                    />
                  </GroupRow>
                </GroupBox>
              ),
            },
            { value: 'a', label: '账户', content: <div>账户设置</div> },
            { value: 'x', label: '高级', content: <div>高级设置</div> },
          ]}
        />
      </Card>

      <Card id="im-window" bg={WALLPAPER} title="WINDOW · IMEXAMPLE 骨架" padding={28}>
        <Window
          title="消息"
          height={560}
          rail={
            <NavRail
              avatar={{ name: 'Yoqu', status: 'online' }}
              defaultSelected="msg"
              items={RAIL}
              footer={[{ id: 'set', label: '设置', icon: 'gear' }]}
            />
          }
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
              actions={[
                { icon: 'video', label: '视频会议' },
                { icon: 'search', label: '搜索聊天记录' },
                { icon: 'more', label: '设置', active: true },
              ]}
            />
          }
          inspector={
            <div style={{ width: 300, display: 'flex', flexDirection: 'column' }}>
              <Toolbar title="群设置" scrolled={false}>
                <ToolbarGroup>
                  <ToolbarButton icon="xmark" label="关闭" />
                </ToolbarGroup>
              </Toolbar>
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <Avatar name="产品设计组" shape="square" size={56} />
                  <b>产品设计组</b>
                </div>
                <GroupBox>
                  <GroupRow label="消息免打扰">
                    <Switch ariaLabel="消息免打扰" />
                  </GroupRow>
                  <GroupRow label="置顶聊天">
                    <Switch defaultChecked ariaLabel="置顶聊天" />
                  </GroupRow>
                </GroupBox>
              </div>
            </div>
          }
          contentStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}
        >
          <MessageList style={{ flex: 1, paddingTop: 20 }}>
            <Message author={{ name: 'Mia Chen', status: 'online' }} time="10:20">
              新版会话列表的稿子更新了，重点看一下未读徽标和加急态。
            </Message>
            <Message self author={{ name: 'Yoqu' }} time="10:31" receipt={{ read: 2, total: 5 }}>
              收到，下午给结论。
            </Message>
          </MessageList>
          <div style={{ padding: '8px 16px 16px' }}>
            <Composer recipient="产品设计组" />
          </div>
        </Window>
      </Card>
    </>
  )
}
