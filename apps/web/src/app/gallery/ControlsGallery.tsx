import type { ReactNode } from 'react'
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Calendar,
  Checkbox,
  CheckboxGroup,
  ColorWell,
  ComboBox,
  DatePicker,
  DropZone,
  GroupBox,
  GroupRow,
  HelpButton,
  Link,
  PopUpButton,
  ProgressIndicator,
  PullDownButton,
  RadioGroup,
  SearchField,
  SecureField,
  SegmentedControl,
  Slider,
  Stepper,
  Switch,
  Tag,
  TextArea,
  TextField,
  TokenField,
} from '../../ui'

const col = { display: 'flex', flexDirection: 'column', gap: 12 } as const
const row = (gap = 12, alignItems = 'center') =>
  ({ display: 'flex', flexWrap: 'wrap', alignItems, gap }) as const

/** One card per Pane component, mirroring docs/design/pane/components/<Comp>/preview.html (its body color and card height). */
function Card({
  name,
  bg = 'window',
  height,
  children,
}: {
  name: string
  bg?: 'window' | 'content'
  height?: number
  children: ReactNode
}) {
  return (
    <div data-card={name} style={{ padding: 20, minHeight: height, background: `var(--${bg}-bg)` }}>
      {children}
    </div>
  )
}

const panel = {
  padding: 12,
  borderRadius: 'var(--radius-menu)',
  background: 'var(--content-bg)',
  boxShadow: 'inset 0 0 0 1px var(--separator)',
} as const

export function ControlsGallery() {
  return (
    <section className="gallery__section" data-testid="controls-gallery">
      <h2 className="eyebrow">PANE 基础控件</h2>
      <Card name="Button">
        <div style={col}>
          <div style={row()}>
            <Button variant="primary">保存</Button>
            <Button>取消</Button>
            <Button variant="destructive">移到废纸篓</Button>
            <Button variant="plain">了解更多…</Button>
            <Button disabled>不可用</Button>
          </div>
          <div style={row()}>
            <Button size="small">小号</Button>
            <Button>常规</Button>
            <Button size="large">大号</Button>
            <Button size="xlarge" variant="primary">
              继续
            </Button>
            <Button icon="plus" aria-label="添加" />
            <Button icon="share">共享</Button>
          </div>
        </div>
      </Card>
      <Card name="Switch">
        <div style={row(28)}>
          <Switch defaultChecked aria-label="Wi-Fi" />
          <Switch aria-label="蓝牙" />
          <Switch size="small" defaultChecked aria-label="小号" />
          <Switch label="自动更新" labelPosition="after" defaultChecked />
          <Switch disabled aria-label="不可用" />
        </div>
      </Card>
      <Card name="Checkbox">
        <div style={row(24)}>
          <Checkbox label="显示隐藏文件" defaultChecked />
          <Checkbox label="显示扩展名" />
          <Checkbox label="全部" indeterminate />
          <Checkbox label="不可用" disabled />
        </div>
      </Card>
      <Card name="CheckboxGroup">
        <CheckboxGroup
          aria-label="通知方式"
          direction="row"
          defaultValue={['banner', 'sound']}
          options={[
            { value: 'banner', label: '横幅' },
            { value: 'sound', label: '声音' },
            { value: 'badge', label: '标记' },
          ]}
        />
      </Card>
      <Card name="RadioGroup">
        <RadioGroup
          aria-label="新窗口打开"
          defaultValue="home"
          options={[
            { value: 'home', label: '个人文件夹' },
            { value: 'desktop', label: '桌面' },
            { value: 'recents', label: '最近使用' },
          ]}
        />
      </Card>
      <Card name="TextField" bg="content" height={240}>
        <div style={row(24, 'flex-start')}>
          <div style={{ ...col, width: 260 }}>
            <TextField
              label="电脑名称"
              defaultValue="Yoqu 的 MacBook Pro"
              hint="局域网中的设备会看到这个名称。"
            />
            <TextField label="电子邮件" placeholder="name@example.com" error="请输入有效的电子邮件地址" />
          </div>
          <div style={{ ...col, width: 260 }}>
            <TextField label="个人网站" prefix="https://" defaultValue="yoqu.example.com" clearable />
            <TextField label="单价" defaultValue="128" suffix="元 / 月" />
            <TextField label="查找" prefix="search" placeholder="在本页查找" clearable />
          </div>
        </div>
      </Card>
      <Card name="SecureField" bg="content" height={120}>
        <div style={row(24, 'flex-start')}>
          <SecureField label="密码" defaultValue="correct-horse" style={{ width: 260 }} />
          <SecureField
            label="确认密码"
            defaultValue="correct-hors"
            error="两次输入的密码不一致"
            style={{ width: 260 }}
          />
        </div>
      </Card>
      <Card name="TextArea" bg="content" height={170}>
        <div style={row(24, 'flex-start')}>
          <TextArea
            label="群介绍"
            defaultValue="IM 2.0 设计与评审，每周四 15:00 例会。"
            maxLength={120}
            autoGrow
            style={{ width: 320 }}
          />
          <TextArea label="反馈" placeholder="描述遇到的问题和复现步骤…" rows={4} style={{ width: 320 }} />
        </div>
      </Card>
      <Card name="Stepper" bg="content" height={90}>
        <div style={row(28, 'flex-end')}>
          <Stepper label="字号" defaultValue={13} min={9} max={32} unit="pt" />
          <Stepper label="行距" defaultValue={1.2} step={0.1} min={1} max={3} width={60} />
          <Stepper label="份数" defaultValue={1} min={1} max={99} width={56} />
        </div>
      </Card>
      <Card name="ComboBox" bg="content" height={260}>
        <div style={row(24, 'flex-start')}>
          <ComboBox
            label="所在城市"
            defaultValue="深圳"
            defaultOpen
            options={['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京']}
            style={{ width: 220 }}
          />
          <ComboBox
            label="字体"
            placeholder="输入或选择字体"
            options={[
              { value: 'pingfang', label: '苹方-简', detail: '系统' },
              { value: 'songti', label: '宋体-简' },
              { value: 'kaiti', label: '楷体-简' },
            ]}
            style={{ width: 220 }}
          />
        </div>
      </Card>
      <Card name="TokenField" bg="content" height={170}>
        <div style={row(24, 'flex-start')}>
          <TokenField
            label="收件人"
            defaultValue={['张三', 'Mia Chen', { label: '王总（星河科技）', tone: 'orange' }]}
            suggestions={['李思远', '李娜', '王小明', { label: '产品设计组', detail: '28 人' }]}
            placeholder="输入姓名或邮箱"
            style={{ width: 340 }}
            hint="输入后按 Enter、逗号或分号确认。"
          />
          <TokenField
            label="标签"
            defaultValue={[
              { label: '设计', tone: 'gray' },
              { label: '评审', tone: 'gray' },
            ]}
            placeholder="添加标签"
            style={{ width: 240 }}
          />
        </div>
      </Card>
      <Card name="DatePicker" bg="content" height={380}>
        <div style={row(24, 'flex-start')}>
          <DatePicker
            label="开始日期"
            defaultValue="2026-10-08"
            defaultOpen
            marks={['2026-10-09', '2026-10-15']}
          />
          <DatePicker label="截止日期" placeholder="选择截止日期" />
        </div>
      </Card>
      <Card name="Calendar" height={310}>
        <div style={row(28, 'flex-start')}>
          <div style={panel}>
            <Calendar
              defaultValue="2026-10-08"
              marks={['2026-10-08', '2026-10-09', '2026-10-15', '2026-10-22']}
              min="2026-10-01"
            />
          </div>
          <div style={panel}>
            <Calendar defaultValue="2026-09-25" />
          </div>
        </div>
      </Card>
      <Card name="ColorWell" bg="content" height={330}>
        <div style={row(40, 'flex-start')}>
          <ColorWell label="标签颜色" defaultValue="#0088ff" defaultOpen />
          <div style={{ ...col, gap: 8 }}>
            <span style={{ fontSize: 'var(--text-callout-size)', color: 'var(--label-secondary)' }}>
              强调色
            </span>
            <ColorWell
              inline
              aria-label="强调色"
              defaultValue="#0088ff"
              colors={[
                '#0088ff',
                '#cb30e0',
                '#ff2d55',
                '#ff383c',
                '#ff8d28',
                '#ffcc00',
                '#34c759',
                '#8e8e93',
              ]}
              names={['蓝色', '紫色', '粉色', '红色', '橙色', '黄色', '绿色', '石墨色']}
            />
          </div>
        </div>
      </Card>
      <Card name="DropZone" bg="content" height={420}>
        <div style={row(24, 'flex-start')}>
          <DropZone
            style={{ width: 330 }}
            multiple
            description="支持 PDF、Keynote、图片，单个文件不超过 200 MB"
            onRemove={() => {}}
            files={[
              { name: '2026 Q3 经营分析.key', size: '42.7 MB', progress: 100 },
              { name: '会话列表-v3.fig', size: '18.4 MB', progress: 46 },
              { name: '录屏-评审.mov', size: '1.2 GB', error: '文件超过 200 MB，无法上传' },
            ]}
          />
          <div style={{ ...col, width: 330 }}>
            <DropZone defaultDragging title="将图片拖到这里" />
            <DropZone compact title="添加附件" description="或拖到此处" />
          </div>
        </div>
      </Card>
      <Card name="SearchField">
        <div style={row(24)}>
          <SearchField placeholder="搜索" />
          <SearchField defaultValue="季度报告" />
        </div>
      </Card>
      <Card name="SegmentedControl">
        <div style={col}>
          <div style={row()}>
            <SegmentedControl
              aria-label="时间范围"
              defaultValue="w"
              items={[
                { value: 'd', label: '日' },
                { value: 'w', label: '周' },
                { value: 'm', label: '月' },
                { value: 'y', label: '年' },
              ]}
            />
          </div>
          <div style={row()}>
            <SegmentedControl
              aria-label="显示方式"
              size="small"
              items={[
                { value: 'grid', icon: 'grid', 'aria-label': '图标' },
                { value: 'list', icon: 'list', 'aria-label': '列表' },
              ]}
            />
            <SegmentedControl
              aria-label="外观"
              size="large"
              defaultValue="c"
              items={[
                { value: 'a', label: '浅色' },
                { value: 'b', label: '深色' },
                { value: 'c', label: '自动' },
              ]}
            />
          </div>
        </div>
      </Card>
      <Card name="Slider">
        <div style={row(32, 'flex-start')}>
          <Slider aria-label="音量" defaultValue={62} />
          <Slider
            aria-label="透明度"
            min={0}
            max={4}
            step={1}
            defaultValue={2}
            ticks={5}
            minLabel="清透"
            maxLabel="着色"
          />
        </div>
      </Card>
      <Card name="ProgressIndicator">
        <div style={row(24)}>
          <ProgressIndicator value={64} aria-label="下载进度" />
          <ProgressIndicator aria-label="正在准备" />
          <ProgressIndicator variant="spinner" />
        </div>
      </Card>
      <Card name="PopUpButton" height={260}>
        <div style={row(24, 'flex-start')}>
          <PopUpButton
            defaultOpen
            defaultValue="name"
            options={[
              { value: 'none', label: '无' },
              { value: 'name', label: '名称' },
              { value: 'kind', label: '种类' },
              { value: 'date', label: '修改日期' },
              { value: 'size', label: '大小' },
            ]}
          />
          <PopUpButton
            options={[
              { value: '1', label: '每天' },
              { value: '7', label: '每周' },
            ]}
          />
        </div>
      </Card>
      <Card name="PullDownButton" bg="content" height={300}>
        <div style={row(20, 'flex-start')}>
          <PullDownButton
            label="新建"
            icon="plus"
            defaultOpen
            items={[
              { label: '群组', value: 'group', shortcut: '⌘N' },
              { label: '会议', value: 'meet' },
              { label: '日程', value: 'event' },
              { separator: true },
              { label: '从模板新建…', value: 'tpl' },
            ]}
          />
          <PullDownButton
            icon="more"
            aria-label="更多操作"
            items={[
              { label: '导出…', value: 'export' },
              { label: '打印…', value: 'print', shortcut: '⌘P' },
            ]}
          />
          <Button variant="primary" loading>
            正在上传
          </Button>
          <Button loading>处理中</Button>
        </div>
      </Card>
      <Card name="HelpButton" bg="content" height={150}>
        <div style={{ ...row(24), paddingTop: 70 }}>
          <HelpButton help="超过保留期限的消息会从这台电脑上移除，云端副本不受影响。" defaultOpen />
          <HelpButton onClick={() => {}} />
        </div>
      </Card>
      <Card name="Link" bg="content" height={70}>
        <div style={row(24)}>
          <Link href="#">了解更多…</Link>
          <Link href="#" external>
            在浏览器中打开
          </Link>
          <span>
            阅读 <Link href="#">隐私政策</Link> 了解详情。
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
        <div style={col}>
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
        </GroupBox>
      </Card>
    </section>
  )
}
