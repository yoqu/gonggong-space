import { Activity, Bot, Cpu, FolderGit2, LayoutDashboard, type LucideIcon, Settings } from 'lucide-react'
import type { ComponentType } from 'react'
import { AgentsPage } from './Agents'
import { BotsPage } from './Bots'
import { LogsPage } from './Logs'
import { OverviewPage } from './Overview'
import { SettingsPage } from './Settings'
import { WorkspacesPage } from './Workspaces'

export type PageKey = 'overview' | 'agents' | 'bots' | 'workspaces' | 'logs' | 'settings'

export interface PageProps {
  go: (page: PageKey) => void
}

/** Left nav order. 同步 (P2) and 个人密钥 (P3) are not built. */
export const PAGES: {
  key: PageKey
  label: string
  icon: LucideIcon
  desc: string
  Component: ComponentType<PageProps>
}[] = [
  {
    key: 'overview',
    label: '概览',
    icon: LayoutDashboard,
    desc: '本机执行端状态与正在运行的轮次',
    Component: OverviewPage,
  },
  {
    key: 'agents',
    label: 'Agent',
    icon: Cpu,
    desc: '本机安装的 CLI 运行时：检测、路径、登录状态与默认模型',
    Component: AgentsPage,
  },
  {
    key: 'bots',
    label: 'Bot',
    icon: Bot,
    desc: '认领到本机的团队 Bot：指定 agent、模型、并发与审批',
    Component: BotsPage,
  },
  {
    key: 'workspaces',
    label: '工作区',
    icon: FolderGit2,
    desc: '每个「群 × Bot」一个托管目录，或 /cd 绑定的本机目录',
    Component: WorkspacesPage,
  },
  {
    key: 'logs',
    label: '日志与诊断',
    icon: Activity,
    desc: '连接、ACP、git 与同步日志；运行过程入库前已脱敏',
    Component: LogsPage,
  },
  { key: 'settings', label: '设置', icon: Settings, desc: '升级、启动项与存储位置', Component: SettingsPage },
]
