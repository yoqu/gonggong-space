import type { IconName } from '@web/ui'
import type { ComponentType } from 'react'
import { AgentsPage } from './Agents'
import { BotsPage } from './Bots'
import { LogsPage } from './Logs'
import { OverviewPage } from './Overview'
import { SettingsPage } from './Settings'
import { TunnelsPage } from './Tunnels'
import { WorkspacesPage } from './Workspaces'

export type PageKey = 'overview' | 'agents' | 'bots' | 'workspaces' | 'tunnels' | 'logs' | 'settings'

export interface PageProps {
  go: (page: PageKey) => void
}

export interface Page {
  key: PageKey
  label: string
  icon: IconName
  /** A `var(--system-*)` sidebar icon color. */
  color: string
  desc: string
  /** Shows a large title in the content, moving it into the toolbar once scrolled (macOS settings panes). */
  largeTitle?: boolean
  Component: ComponentType<PageProps>
}

/** Sidebar sections in order. 同步 (P2) and 个人密钥 (P3) are not built. */
export const SECTIONS: { title?: string; pages: Page[] }[] = [
  {
    pages: [
      {
        key: 'overview',
        label: '概览',
        icon: 'dashboard',
        color: 'var(--system-blue)',
        desc: '本机执行端状态与正在运行的轮次',
        Component: OverviewPage,
      },
    ],
  },
  {
    title: '执行',
    pages: [
      {
        key: 'agents',
        label: 'Agent',
        icon: 'cpu',
        color: 'var(--system-purple)',
        desc: '本机安装的 CLI 运行时：检测、路径、登录状态与默认模型',
        Component: AgentsPage,
      },
      {
        key: 'bots',
        label: 'Bot',
        icon: 'bot',
        color: 'var(--system-indigo)',
        desc: '认领到本机的团队 Bot：指定 agent、模型、并发与审批',
        Component: BotsPage,
      },
      {
        key: 'workspaces',
        label: '工作区',
        icon: 'folder-git',
        color: 'var(--system-orange)',
        desc: '每个「群 × Bot」一个托管目录，或 /cd 绑定的本机目录',
        Component: WorkspacesPage,
      },
      {
        key: 'tunnels',
        label: '穿透与服务',
        icon: 'globe',
        color: 'var(--system-teal)',
        desc: 'Bot 开放的预览穿透与后台托管的服务，可在本机停止',
        Component: TunnelsPage,
      },
    ],
  },
  {
    title: '本机',
    pages: [
      {
        key: 'logs',
        label: '日志与诊断',
        icon: 'activity',
        color: 'var(--system-green)',
        desc: '连接、ACP、git 与同步日志；运行过程入库前已脱敏',
        Component: LogsPage,
      },
      {
        key: 'settings',
        label: '设置',
        icon: 'gear',
        color: 'var(--system-gray)',
        desc: '外观、升级、启动项与存储位置',
        largeTitle: true,
        Component: SettingsPage,
      },
    ],
  },
]

export const PAGES = SECTIONS.flatMap((s) => s.pages)
