import type { ReactNode } from 'react'
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Checkbox,
  GroupBox,
  GroupRow,
  PopUpButton,
  ProgressIndicator,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Slider,
  Switch,
  Tag,
  TextField,
} from '../../ui'

const col = { display: 'flex', flexDirection: 'column', gap: 12 } as const
const row = (gap = 12, alignItems = 'center') =>
  ({ display: 'flex', flexWrap: 'wrap', alignItems, gap }) as const

/** One card per Pane component, mirroring docs/design/pane/components/<Comp>/preview.html. */
function Card({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-card={name} style={{ padding: 20, background: 'var(--window-bg)' }}>
      {children}
    </div>
  )
}

export function ControlsGallery() {
  return (
    <section className="gallery__section" data-testid="controls-gallery">
      <h2 className="eyebrow">PANE 基础控件</h2>
      <Card name="Button">
        <div style={col}>
          <div style={row()}>
            <Button variant="primary">存储</Button>
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
      <Card name="TextField">
        <div style={row(24, 'flex-start')}>
          <TextField
            label="电脑名称"
            defaultValue="Yoqu 的 MacBook Pro"
            hint="局域网中的设备会看到这个名称。"
          />
          <TextField label="电子邮件" placeholder="name@example.com" error="请输入有效的电子邮件地址" />
          <TextField label="系统提示词" multiline rows={3} placeholder="你是一个严谨的代码评审助手" />
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
      <Card name="PopUpButton">
        <div style={{ ...row(24, 'flex-start'), minHeight: 170 }}>
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
