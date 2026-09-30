import type { IconName } from '@web/ui'
import type { ComponentType } from 'react'
import { AgentsPage } from './Agents'
import { BotsPage } from './Bots'
import { LivePage } from './Live'
import { LogsPage } from './Logs'
import { OverviewPage } from './Overview'
import { SettingsPage } from './Settings'
import { TunnelsPage } from './Tunnels'
import { WorkspacesPage } from './Workspaces'

export type PageKey = 'overview' | 'agents' | 'bots' | 'workspaces' | 'tunnels' | 'live' | 'logs' | 'settings'

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
        desc: '本机的 Node.js 与 CLI 运行时：安装升级、检测与供应商',
        Component: AgentsPage,
      },
      {
        key: 'bots',
        label: 'Bot',
        icon: 'bot',
        color: 'var(--system-indigo)',
        desc: '本机运行的 Bot 与其供应商，其余设置请在 Web 端修改',
        Component: BotsPage,
      },
      {
        key: 'workspaces',
        label: '工作区',
        icon: 'folder-git',
        color: 'var(--system-orange)',
        desc: '每个「群 × Bot」一个托管目录，或绑定的本机目录',
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
      {
        key: 'live',
        label: '实时画面',
        icon: 'video',
        color: 'var(--system-red)',
        desc: 'Bot 推送的桌面应用与小程序画面：推流组件、系统权限与推流状态',
        Component: LivePage,
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
        desc: '外观、升级、镜像源、启动项与存储位置',
        Component: SettingsPage,
      },
    ],
  },
]

export const PAGES = SECTIONS.flatMap((s) => s.pages)
