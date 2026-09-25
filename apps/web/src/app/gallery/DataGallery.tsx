import type { ReactNode } from 'react'
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Checkbox,
  Disclosure,
  Divider,
  EmptyState,
  Form,
  FormActions,
  FormRow,
  GroupBox,
  GroupRow,
  Icon,
  Kbd,
  LevelIndicator,
  PathControl,
  PopUpButton,
  ProgressIndicator,
  RadioGroup,
  SegmentedControl,
  Skeleton,
  Slider,
  Switch,
  Table,
  type TableColumn,
  Tag,
  TextField,
} from '../../ui'

const col = (gap = 12) => ({ display: 'flex', flexDirection: 'column', gap }) as const
const row = (gap = 12, alignItems = 'center') =>
  ({ display: 'flex', flexWrap: 'wrap', alignItems, gap }) as const

/** One card per Pane component, mirroring docs/design/pane/components/<Comp>/preview.html. */
function Card({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-card={name} style={{ padding: 20, background: 'var(--content-bg)' }}>
      {children}
    </div>
  )
}

interface FileRow {
  id: string
  name: string
  kind: string
  date: string
  sortDate: number
  size: number | null
  children?: FileRow[]
}

const fileColumns: TableColumn<FileRow>[] = [
  {
    key: 'name',
    title: '名称',
    sortable: true,
    render: (r) => (
      <>
        <Icon
          name={r.children ? 'folder' : 'doc'}
          color={r.children ? 'var(--system-blue)' : 'var(--label-secondary)'}
        />
        <span>{r.name}</span>
      </>
    ),
  },
  {
    key: 'date',
    title: '修改日期',
    width: 130,
    sortable: true,
    secondary: true,
    sortValue: (r) => r.sortDate,
  },
  {
    key: 'size',
    title: '大小',
    width: 80,
    align: 'right',
    sortable: true,
    secondary: true,
    sortValue: (r) => r.size ?? -1,
    render: (r) => (r.size == null ? '--' : r.size < 1 ? `${Math.round(r.size * 1000)} KB` : `${r.size} MB`),
  },
  { key: 'kind', title: '种类', width: 140, sortable: true, secondary: true },
]

const files: FileRow[] = [
  {
    id: 'd1',
    name: '设计稿',
    kind: '文件夹',
    date: '今天 10:12',
    sortDate: 20260925,
    size: null,
    children: [
      {
        id: 'f1',
        name: '会话列表-v3.fig',
        kind: 'Figma 文件',
        date: '今天 10:12',
        sortDate: 20260925,
        size: 18.4,
      },
      { id: 'f2', name: '图标规范.pdf', kind: 'PDF 文稿', date: '昨天 18:20', sortDate: 20260924, size: 2.1 },
    ],
  },
  {
    id: 'd2',
    name: '周报',
    kind: '文件夹',
    date: '9月22日',
    sortDate: 20260922,
    size: null,
    children: [
      {
        id: 'f5',
        name: '第 38 周.pages',
        kind: 'Pages 文稿',
        date: '9月22日',
        sortDate: 20260922,
        size: 0.4,
      },
    ],
  },
  {
    id: 'f3',
    name: '2026 Q3 经营分析.key',
    kind: 'Keynote 演示文稿',
    date: '9月20日',
    sortDate: 20260920,
    size: 42.7,
  },
  {
    id: 'f4',
    name: '渠道数据汇总-9月.numbers',
    kind: 'Numbers 表格',
    date: '9月18日',
    sortDate: 20260918,
    size: 1.1,
  },
  { id: 'f6', name: 'README.md', kind: 'Markdown 文本', date: '9月2日', sortDate: 20260902, size: 0.01 },
]

const members = [
  { id: 'A1024', name: '张三', dept: '前端', role: '成员' },
  { id: 'A1031', name: '李思远', dept: '产品', role: '管理员' },
  { id: 'A1045', name: 'Mia Chen', dept: '设计', role: '成员' },
  { id: 'A1052', name: '王小明', dept: '后端', role: '成员' },
]

const emptyCard = {
  flex: 1,
  background: 'var(--content-bg)',
  borderRadius: 12,
  boxShadow: 'inset 0 0 0 1px var(--separator)',
}

export function DataGallery() {
  return (
    <section className="gallery__section" data-testid="data-gallery">
      <h2 className="eyebrow">PANE 数据展示 · 布局 · 反馈</h2>
      <Card name="Table">
        <div style={col(20)}>
          <Table
            aria-label="文稿"
            columns={fileColumns}
            rows={files}
            defaultSort={{ key: 'name', dir: 'asc' }}
            defaultExpanded={['d1']}
            defaultSelection={['f1', 'f2']}
            active
            maxHeight={230}
          />
          <Table
            aria-label="成员"
            density="compact"
            columns={[
              { key: 'name', title: '成员', sortable: true },
              { key: 'dept', title: '部门', width: 120, secondary: true, sortable: true },
              { key: 'role', title: '角色', width: 100, secondary: true },
              { key: 'id', title: '工号', width: 90, align: 'right', mono: true, secondary: true },
            ]}
            rows={members}
            defaultSelection={['A1031']}
          />
        </div>
      </Card>
      <Card name="LevelIndicator">
        <div style={{ ...col(22), maxWidth: 420 }}>
          <LevelIndicator
            aria-label="储存空间"
            max={256}
            value={186}
            warning={200}
            critical={240}
            label={
              <>
                <b>Macintosh HD</b>
                <span style={{ color: 'var(--label-secondary)' }}>已用 186 GB，共 256 GB</span>
              </>
            }
            parts={[
              { value: 72, color: 'var(--system-blue)', label: '应用程序' },
              { value: 58, color: 'var(--system-purple)', label: '文稿' },
              { value: 38, color: 'var(--system-orange)', label: '照片' },
              { value: 18, color: 'var(--system-gray)', label: '系统数据' },
            ]}
          />
          <div style={row(28)}>
            <LevelIndicator kind="discrete" aria-label="信号" value={70} segments={10} />
            <LevelIndicator kind="discrete" aria-label="电量" value={92} warning={80} segments={10} />
            <LevelIndicator kind="discrete" aria-label="磁盘" value={96} critical={90} segments={10} />
          </div>
          <div style={row(28)}>
            <LevelIndicator kind="rating" value={4} aria-label="评分" />
            <span style={{ ...row(8), fontSize: 12 }}>
              为这次会议打分
              <LevelIndicator kind="rating" editable defaultValue={3} size={18} aria-label="会议评分" />
            </span>
          </div>
        </div>
      </Card>
      <Card name="PathControl">
        <div style={col()}>
          <PathControl
            items={[
              { id: 'mac', label: 'Macintosh HD', icon: 'hard-drive' },
              { id: 'users', label: '用户', icon: 'folder', color: 'var(--system-blue)' },
              { id: 'yoqu', label: 'yoqu', icon: 'person' },
              { id: 'docs', label: '文稿', icon: 'folder', color: 'var(--system-blue)' },
              { id: 'rep', label: '报告', icon: 'folder', color: 'var(--system-blue)' },
              { id: 'q3', label: '2026 Q3 经营分析.key', icon: 'doc' },
            ]}
          />
          <PathControl
            items={[
              { id: 'docs', label: '文稿', icon: 'folder', color: 'var(--system-blue)' },
              { id: 'q3', label: '季度报告.pages', icon: 'doc' },
            ]}
          />
        </div>
      </Card>
      <Card name="Form">
        <Form aria-label="账户设置" style={{ maxWidth: 560 }}>
          <FormRow label="显示名称">
            <TextField defaultValue="Yoqu" aria-label="显示名称" />
          </FormRow>
          <FormRow label="电子邮件" hint="用于登录和接收安全提醒。">
            <TextField defaultValue="yoqu@example.com" aria-label="电子邮件" />
          </FormRow>
          <FormRow label="语言">
            <PopUpButton
              aria-label="语言"
              defaultValue="zh"
              options={[
                { value: 'zh', label: '简体中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </FormRow>
          <FormRow label="通知" align="top">
            <div style={col(6)}>
              <Checkbox defaultChecked label="新消息" />
              <Checkbox defaultChecked label="有人 @我" />
              <Checkbox label="日程提醒" />
            </div>
          </FormRow>
          <Divider />
          <FormRow label="开机时启动">
            <Switch defaultChecked aria-label="开机时启动" />
          </FormRow>
          <FormActions>
            <Button>恢复默认</Button>
            <Button variant="primary" type="submit">
              存储
            </Button>
          </FormActions>
        </Form>
      </Card>
      <Card name="Disclosure">
        <div style={{ ...col(), maxWidth: 520 }}>
          <Disclosure title="高级" summary="3 项设置">
            <Checkbox label="使用硬件加速" />
          </Disclosure>
          <Disclosure title="网络代理" defaultOpen>
            <RadioGroup
              aria-label="代理"
              defaultValue="sys"
              options={[
                { value: 'sys', label: '使用系统代理' },
                { value: 'none', label: '不使用代理' },
                { value: 'custom', label: '手动配置…' },
              ]}
            />
          </Disclosure>
          <Disclosure title="诊断信息" variant="group" defaultOpen>
            <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
              版本 2.8.0（2026.09.25） · macOS 27.0
            </div>
            <Button size="small" icon="copy">
              拷贝诊断信息
            </Button>
          </Disclosure>
        </div>
      </Card>
      <Card name="Divider">
        <div style={{ ...col(18), maxWidth: 420 }}>
          <Divider />
          <Divider label="或者" />
          <div style={row()}>
            拷贝
            <Divider vertical />
            粘贴
            <Divider vertical />
            全选
          </div>
        </div>
      </Card>
      <Card name="EmptyState">
        <div style={row(16, 'stretch')}>
          <EmptyState
            style={emptyCard}
            icon="bubble"
            title="选择一个会话"
            description="从左侧列表选择会话开始聊天，或新建一个群组。"
            action={<Button icon="plus">新建群组</Button>}
          />
          <EmptyState
            style={emptyCard}
            icon="search"
            title="没有找到「季度复盘」"
            description="试试其他关键词，或在云文档中搜索。"
            action={<Button variant="plain">在云文档中搜索</Button>}
          />
        </div>
      </Card>
      <Card name="Skeleton">
        <div style={row(24, 'flex-start')}>
          <div style={{ width: 288, background: 'var(--sidebar-bg)', borderRadius: 12, padding: '4px 0' }}>
            <Skeleton variant="conversation" count={4} />
          </div>
          <div style={{ flex: 1, minWidth: 300 }}>
            <Skeleton variant="message" count={3} />
            <div style={{ height: 20 }} />
            <Skeleton variant="text" count={3} />
          </div>
        </div>
      </Card>
      <Card name="Kbd">
        <div style={row(24)}>
          <span>
            搜索 <Kbd keys={['⌘', 'K']} />
          </span>
          <span>
            新建群组 <Kbd keys={['⌘', '⇧', 'N']} />
          </span>
          <span>
            发送 <Kbd>Enter</Kbd>
          </span>
          <span>
            换行 <Kbd keys={['⇧', 'Enter']} />
          </span>
        </div>
      </Card>
      <Card name="Tag">
        <div style={row(8)}>
          <Tag tone="orange">外部</Tag>
          <Tag tone="blue">机器人</Tag>
          <Tag tone="green">官方</Tag>
          <Tag tone="purple">全员</Tag>
          <Tag tone="gray">部门</Tag>
          <Tag tone="red">已拒绝</Tag>
          <Tag tone="solid-red" icon="bolt">
            加急
          </Tag>
          <Badge count={3} />
          <Badge count={128} />
          <Badge count={12} muted />
        </div>
      </Card>
      <Card name="Avatar">
        <div style={col()}>
          <div style={row(16)}>
            <Avatar name="张三" size={40} status="online" />
            <Avatar name="李思远" size={40} status="busy" />
            <Avatar name="Mia Chen" size={40} status="away" />
            <Avatar name="王小明" size={32} />
            <Avatar name="赵六" size={20} />
            <Avatar name="产品设计组" size={40} shape="square" />
          </div>
          <div style={row()}>
            <AvatarGroup
              size={20}
              people={[
                { name: '张三' },
                { name: '李思远' },
                { name: 'Mia Chen' },
                { name: '王小明' },
                { name: '赵六' },
              ]}
            />
          </div>
        </div>
      </Card>
      <Card name="ProgressIndicator">
        <div style={row(24)}>
          <ProgressIndicator value={64} aria-label="下载进度" />
          <ProgressIndicator aria-label="正在准备" />
          <ProgressIndicator variant="spinner" />
        </div>
      </Card>
      <Card name="GroupBox">
        <GroupBox style={{ maxWidth: 520 }}>
          <GroupRow label="外观">
            <SegmentedControl
              aria-label="外观"
              defaultValue="a"
              items={[
                { value: 'l', label: '浅色' },
                { value: 'd', label: '深色' },
                { value: 'a', label: '自动' },
              ]}
            />
          </GroupRow>
          <GroupRow label="Liquid Glass" description="调节窗口与控件的透明程度">
            <Slider style={{ minWidth: 160 }} min={0} max={4} defaultValue={1} aria-label="Liquid Glass" />
          </GroupRow>
          <GroupRow label="在菜单栏中显示">
            <Switch defaultChecked aria-label="在菜单栏中显示" />
          </GroupRow>
          <GroupRow label="墙纸" value="金门大桥" onClick={() => {}} />
        </GroupBox>
      </Card>
    </section>
  )
}
