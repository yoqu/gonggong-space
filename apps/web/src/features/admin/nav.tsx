import type { ReactNode } from 'react'
import { t } from '../../i18n'
import type { IconName } from '../../ui'
import { BotsAdminPage } from '../bots/BotsAdminPage'
import { ConfigPage } from '../config/ConfigPage'
import { ConversationStatsPage } from '../conversation-stats/ConversationStatsPage'
import { FeishuAdminPage } from '../feishu/FeishuAdminPage'
import { SharesPage } from '../previews/SharesPage'
import { UsagePage } from '../usage/UsagePage'
import { AuditPage } from './AuditPage'
import { GroupsPage } from './GroupsPage'
import { MachinesPage } from './MachinesPage'
import { ParamsPage } from './ParamsPage'
import { ReleasesPage } from './ReleasesPage'
import { SchedulesPage } from './SchedulesPage'
import { TeamsPage } from './TeamsPage'
import { UsersPage } from './UsersPage'

export interface AdminItem {
  /** Route under /admin. */
  path: string
  label: string
  icon: IconName
  /** A `var(--system-*)` sidebar icon color. */
  color: string
  element: ReactNode
}

/** Route table + left nav of 管理后台.dc.html (sysadmins only). */
export const ADMIN_NAV: { head: string; items: AdminItem[] }[] = [
  {
    head: t('管理'),
    items: [
      {
        path: 'users',
        label: t('账号与角色'),
        icon: 'person-2',
        color: 'var(--system-blue)',
        element: <UsersPage />,
      },
      {
        path: 'teams',
        label: t('团队#nav'),
        icon: 'contacts',
        color: 'var(--system-teal)',
        element: <TeamsPage />,
      },
      {
        path: 'bots',
        label: t('Bot#nav'),
        icon: 'bot',
        color: 'var(--system-purple)',
        element: <BotsAdminPage />,
      },
      {
        path: 'groups',
        label: t('群#nav'),
        icon: 'hashtag',
        color: 'var(--system-green)',
        element: <GroupsPage />,
      },
      {
        path: 'schedules',
        label: t('定时任务'),
        icon: 'clock',
        color: 'var(--system-orange)',
        element: <SchedulesPage />,
      },
    ],
  },
  {
    head: t('配置'),
    items: [
      {
        path: 'config',
        label: t('配置中心'),
        icon: 'plug',
        color: 'var(--system-orange)',
        element: <ConfigPage />,
      },
      {
        path: 'params',
        label: t('系统参数'),
        icon: 'slider-horizontal',
        color: 'var(--system-gray)',
        element: <ParamsPage />,
      },
      {
        path: 'feishu',
        label: t('飞书'),
        icon: 'send',
        color: 'var(--system-blue)',
        element: <FeishuAdminPage />,
      },
      {
        path: 'releases',
        label: t('客户端发布'),
        icon: 'download',
        color: 'var(--system-blue)',
        element: <ReleasesPage />,
      },
    ],
  },
  {
    head: t('观测'),
    items: [
      {
        path: 'machines',
        label: t('电脑#nav'),
        icon: 'server',
        color: 'var(--system-indigo)',
        element: <MachinesPage />,
      },
      {
        path: 'conversations',
        label: t('会话统计'),
        icon: 'bubble',
        color: 'var(--system-green)',
        element: <ConversationStatsPage />,
      },
      {
        path: 'usage',
        label: t('用量'),
        icon: 'chart-bar',
        color: 'var(--system-teal)',
        element: <UsagePage />,
      },
      {
        path: 'previews',
        label: t('公开链接#nav'),
        icon: 'link',
        color: 'var(--system-cyan)',
        element: <SharesPage />,
      },
      {
        path: 'audit',
        label: t('审计记录'),
        icon: 'doc-text',
        color: 'var(--system-brown)',
        element: <AuditPage />,
      },
    ],
  },
]
