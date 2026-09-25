import type { ReactNode } from 'react'
import type { IconName } from '../../ui'
import { BotsAdminPage } from '../bots/BotsAdminPage'
import { ConfigPage } from '../config/ConfigPage'
import { UsagePage } from '../usage/UsagePage'
import { AuditPage } from './AuditPage'
import { GroupsPage } from './GroupsPage'
import { MachinesPage } from './MachinesPage'
import { ParamsPage } from './ParamsPage'
import { UsersPage } from './UsersPage'

export interface AdminItem {
  /** Route under /admin. */
  path: string
  label: string
  icon: IconName
  /** A `var(--system-*)` sidebar icon color. */
  color: string
  /** Page description, also used by the placeholder until a slice supplies `element`. */
  desc: string
  element?: ReactNode
}

/** Route table + left nav of 管理后台.dc.html (sysadmins only). Slices add their page by setting `element` on their item. */
export const ADMIN_NAV: { head: string; items: AdminItem[] }[] = [
  {
    head: '管理',
    items: [
      {
        path: 'users',
        label: '账号与角色',
        icon: 'person-2',
        color: 'var(--system-blue)',
        desc: '创建账号、分配角色、重置密码；停用会立即断开该成员的所有机器与登录。',
        element: <UsersPage />,
      },
      {
        path: 'bots',
        label: 'Bot',
        icon: 'bot',
        color: 'var(--system-purple)',
        desc: '全部 Bot 的归属、绑定与状态；可为任何成员新建，新建时直接绑定归属人的机器与 agent。',
        element: <BotsAdminPage />,
      },
      {
        path: 'groups',
        label: '群',
        icon: 'hashtag',
        color: 'var(--system-green)',
        desc: '所有群的模式、仓库与权威副本状态。',
        element: <GroupsPage />,
      },
    ],
  },
  {
    head: '配置',
    items: [
      {
        path: 'config',
        label: '配置中心',
        icon: 'plug',
        color: 'var(--system-orange)',
        desc: '仓库基线之上叠加服务器全局层与群层，冲突时服务器优先；不修改仓库文件。',
        element: <ConfigPage />,
      },
      {
        path: 'params',
        label: '系统参数',
        icon: 'slider-horizontal',
        color: 'var(--system-gray)',
        desc: '全局默认值；群级参数由群管理员在群设置中调整。',
        element: <ParamsPage />,
      },
    ],
  },
  {
    head: '观测',
    items: [
      {
        path: 'machines',
        label: '机器',
        icon: 'server',
        color: 'var(--system-indigo)',
        desc: '所有机器的系统、硬件、daemon 版本、在线状态与网络质量记录。',
        element: <MachinesPage />,
      },
      {
        path: 'usage',
        label: '用量',
        icon: 'chart-bar',
        color: 'var(--system-teal)',
        desc: '按 Bot、触发人、群汇总 token 用量。',
        element: <UsagePage />,
      },
      {
        path: 'audit',
        label: '审计记录',
        icon: 'doc-text',
        color: 'var(--system-brown)',
        desc: '审批、提问、锁与同步事件、管理员操作，永久保存。',
        element: <AuditPage />,
      },
    ],
  },
]
