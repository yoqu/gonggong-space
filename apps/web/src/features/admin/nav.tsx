import {
  BarChart3,
  Bot,
  Hash,
  Layers,
  type LucideIcon,
  ScrollText,
  Server,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
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
  icon: LucideIcon
  /** Page subtitle, also used by the placeholder until a slice supplies `element`. */
  desc: string
  sysadminOnly?: boolean
  element?: ReactNode
}

/** Route table + left nav of 管理后台.dc.html. Slices add their page by setting `element` on their item. */
export const ADMIN_NAV: { head: string; items: AdminItem[] }[] = [
  {
    head: '管理',
    items: [
      {
        path: 'users',
        label: '账号与角色',
        icon: Users,
        desc: '系统管理员创建账号、分配角色；停用会吊销该成员所有 daemon 与会话。',
        sysadminOnly: true,
        element: <UsersPage />,
      },
      {
        path: 'bots',
        label: 'Bot',
        icon: Bot,
        desc: '新建时直接绑定归属人的机器与 agent；成员本人只能为自己创建，管理员可为任何人创建。',
        element: <BotsAdminPage />,
      },
      {
        path: 'groups',
        label: '群',
        icon: Hash,
        desc: '所有群的模式、仓库与权威副本状态。',
        sysadminOnly: true,
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
        icon: Layers,
        desc: '仓库基线之上叠加服务器全局层与群层，冲突时服务器优先；不修改仓库文件。',
        sysadminOnly: true,
        element: <ConfigPage />,
      },
      {
        path: 'params',
        label: '系统参数',
        icon: SlidersHorizontal,
        desc: '全局默认值；群级参数由群管理员在群设置中调整。',
        sysadminOnly: true,
        element: <ParamsPage />,
      },
    ],
  },
  {
    head: '观测',
    items: [
      {
        path: 'net',
        label: '机器与网络',
        icon: Server,
        desc: '每台 daemon 的版本、心跳与网络质量记录。',
        sysadminOnly: true,
        element: <MachinesPage />,
      },
      {
        path: 'usage',
        label: '用量',
        icon: BarChart3,
        desc: '按 bot、触发人、群汇总 token 用量。',
        element: <UsagePage />,
      },
      {
        path: 'audit',
        label: '审计记录',
        icon: ScrollText,
        desc: '审批、提问、锁与同步事件、管理员操作，永久保存。',
        sysadminOnly: true,
        element: <AuditPage />,
      },
    ],
  },
]
