import { Inbox, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Drawer,
  EmptyState,
  Input,
  Progress,
  Select,
  Spinner,
  StepIndicator,
  Switch,
  Tabs,
  Textarea,
  Toaster,
  toast,
} from '../ui'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery__section">
      <h2 className="eyebrow">{title}</h2>
      <div className="gallery__row">{children}</div>
    </section>
  )
}

/** Dev-only visual review of every design-system component. */
export default function UiGallery() {
  const [tab, setTab] = useState<'process' | 'diff' | 'audit'>('process')
  const [on, setOn] = useState(true)
  const [checked, setChecked] = useState(true)
  const [agent, setAgent] = useState<'claude' | 'codex'>('claude')
  const [dialog, setDialog] = useState(false)
  const [drawer, setDrawer] = useState(false)

  return (
    <div className="gallery">
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>组件库</h1>

      <Section title="BUTTON">
        {(['primary', 'default', 'outline', 'ghost', 'destructive'] as const).map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
        <Button variant="primary" disabled>
          disabled
        </Button>
      </Section>
      <Section title="BUTTON SIZES">
        {(['xs', 'sm', 'md', 'lg'] as const).map((s) => (
          <Button key={s} variant="primary" size={s}>
            <Plus size={12} />
            {s}
          </Button>
        ))}
        <div style={{ width: 240 }}>
          <Button variant="outline" size="lg" fullWidth>
            fullWidth
          </Button>
        </div>
      </Section>

      <Section title="BADGE">
        {(['success', 'warning', 'info', 'secondary', 'outline', 'destructive'] as const).map((v) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        ))}
        <Badge variant="info" size="xs">
          xs
        </Badge>
      </Section>

      <Section title="TABS">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'process', label: '过程' },
            { value: 'diff', label: '改动' },
            { value: 'audit', label: '审计' },
          ]}
        />
        <Tabs
          size="sm"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'process', label: '过程' },
            { value: 'diff', label: '改动' },
            { value: 'audit', label: '审计', disabled: true },
          ]}
        />
      </Section>

      <Section title="SWITCH · CHECKBOX">
        <Switch checked={on} onChange={setOn} label="消息免打扰" />
        <Switch checked={false} onChange={() => {}} label="禁用" disabled />
        <Checkbox checked={checked} onChange={setChecked} label="设为群管理员" />
        <Checkbox checked={false} onChange={() => {}} label="未选中" />
      </Section>

      <Section title="INPUT · TEXTAREA · SELECT">
        <div className="gallery__field">
          <Input placeholder="如：退款 v2 迁移" />
        </div>
        <div className="gallery__field">
          <Input mono placeholder="git@git.corp:team/repo.git" invalid />
        </div>
        <div className="gallery__field">
          <Select
            value={agent}
            onChange={setAgent}
            options={[
              { value: 'claude', label: 'Claude Code' },
              { value: 'codex', label: 'Codex' },
            ]}
          />
        </div>
        <div className="gallery__field">
          <Textarea rows={2} placeholder="系统提示词" />
        </div>
      </Section>

      <Section title="ALERT">
        <div className="gallery__col">
          <Alert variant="info" title="提示" description="绑定后该机器归属于你。" />
          <Alert variant="success" title="已绑定" description="wanglei-mbp 已上线。" />
          <Alert
            variant="warning"
            title="服务器不可用 · 指数退避重连中"
            description="运行中的轮次在本地继续。"
          />
          <Alert variant="error" title="协议版本不兼容" description="升级 daemon 后重试。" />
        </div>
      </Section>

      <Section title="PROGRESS · SPINNER · STEPS">
        <div className="gallery__col" style={{ width: 280 }}>
          <Progress value={62} size="sm" />
          <Progress value={80} variant="success" />
          <Progress value={40} variant="warning" />
          <Progress value={20} variant="danger" />
        </div>
        <Spinner />
        <StepIndicator
          steps={[
            { label: '生成绑定码', status: 'completed' },
            { label: '本机登录', status: 'active' },
            { label: '上报 agent', status: 'pending' },
            { label: '校验失败', status: 'error' },
          ]}
        />
      </Section>

      <Section title="AVATAR · CLOSE · EMPTY">
        <Avatar name="王磊" />
        <Avatar name="李娜" size={44} />
        <CloseButton />
        <div style={{ width: 320 }}>
          <EmptyState
            icon={<Inbox size={20} />}
            title="还没有 bot"
            description="新建一个 bot，绑定到你的机器上的 Claude Code 或 Codex。"
            actions={
              <Button size="sm" variant="primary">
                新建 bot
              </Button>
            }
          />
        </div>
      </Section>

      <Section title="OVERLAYS">
        <Button onClick={() => setDialog(true)}>打开 Dialog</Button>
        <Button onClick={() => setDrawer(true)}>打开 Drawer</Button>
        <Button onClick={() => toast({ type: 'success', title: '已保存', message: '群设置已更新' })}>
          Toast
        </Button>
        <Button onClick={() => toast({ type: 'error', message: '发送失败，请重试' })}>Toast 错误</Button>
      </Section>

      <Dialog
        open={dialog}
        title="绑定新机器"
        subtitle="一次性绑定码"
        onClose={() => setDialog(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(false)}>
              取消
            </Button>
            <Button variant="primary">确定</Button>
          </>
        }
      >
        在本机终端执行 aiws login --code K7QM-4X2P
      </Dialog>
      <Drawer open={drawer} title="群设置" onClose={() => setDrawer(false)}>
        <div style={{ padding: 16 }}>抽屉内容</div>
      </Drawer>
      <Toaster />
    </div>
  )
}
