import type { ReactNode } from 'react'
import { t } from '../../i18n'
import type { IconName } from '../../ui'
import { BotsAdminPage } from '../bots/BotsAdminPage'
import { ConfigPage } from '../config/ConfigPage'
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
  /** Page description, also used by the placeholder until a slice supplies `element`. */
  desc: string
  element?: ReactNode
}

/** Route table + left nav of 管理后台.dc.html (sysadmins only). Slices add their page by setting `element` on their item. */
export const ADMIN_NAV: { head: string; items: AdminItem[] }[] = [
  {
    head: t('管理'),
    items: [
      {
        path: 'users',
        label: t('账号与角色'),
        icon: 'person-2',
        color: 'var(--system-blue)',
        desc: t('创建账号、分配角色、重置密码；停用会立即断开该成员的所有机器与登录。'),
        element: <UsersPage />,
      },
      {
        path: 'teams',
        label: t('团队#nav'),
        icon: 'contacts',
        color: 'var(--system-teal)',
        desc: t('全部团队的所有者、成员数与状态；团队内的成员、邀请与配置由团队管理员在团队设置中管理。'),
        element: <TeamsPage />,
      },
      {
        path: 'bots',
        label: t('Bot#nav'),
        icon: 'bot',
        color: 'var(--system-purple)',
        desc: t('全部 Bot 的归属、绑定与状态；可为任何成员新建，新建时直接绑定归属人的机器与 agent。'),
        element: <BotsAdminPage />,
      },
      {
        path: 'groups',
        label: t('群#nav'),
        icon: 'hashtag',
        color: 'var(--system-green)',
        desc: t('所有群的模式、仓库与权威副本状态。'),
        element: <GroupsPage />,
      },
      {
        path: 'schedules',
        label: t('定时任务'),
        icon: 'clock',
        color: 'var(--system-orange)',
        desc: t('各群与私聊的定时任务，可停用或删除任意任务。'),
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
        desc: t('仓库基线之上依次叠加平台层、团队层与群层 MCP，同名时下层覆盖上层；不修改仓库文件。'),
        element: <ConfigPage />,
      },
      {
        path: 'params',
        label: t('系统参数'),
        icon: 'slider-horizontal',
        color: 'var(--system-gray)',
        desc: t('平台默认值；团队管理员可在团队设置中覆盖部分参数，群管理员再在群设置中调整群级参数。'),
        element: <ParamsPage />,
      },
      {
        path: 'feishu',
        label: t('飞书'),
        icon: 'send',
        color: 'var(--system-blue)',
        desc: t(
          '主应用负责飞书一键登录，并把成员发给 Bot 的消息同步到飞书；每个 Bot 的应用在 Bot 设置中绑定。',
        ),
        element: <FeishuAdminPage />,
      },
      {
        path: 'releases',
        label: t('客户端发布'),
        icon: 'download',
        color: 'var(--system-blue)',
        desc: t(
          '成员机器上的 daemon 连上后自动升级到这里的版本；gg-cast 在首次推送实时画面时按需下载；桌面端安装包与 Linux daemon 供成员在「绑定新机器」中下载。',
        ),
        element: <ReleasesPage />,
      },
    ],
  },
  {
    head: t('观测'),
    items: [
      {
        path: 'machines',
        label: t('机器#nav'),
        icon: 'server',
        color: 'var(--system-indigo)',
        desc: t('所有机器的系统、硬件、daemon 版本、在线状态与网络质量记录。'),
        element: <MachinesPage />,
      },
      {
        path: 'usage',
        label: t('用量'),
        icon: 'chart-bar',
        color: 'var(--system-teal)',
        desc: t('按 Bot、触发人、群汇总 token 用量。'),
        element: <UsagePage />,
      },
      {
        path: 'previews',
        label: t('公开链接#nav'),
        icon: 'link',
        color: 'var(--system-cyan)',
        desc: t('Bot 预览的外部公开链接：到期或收回后立即失效，访问记入审计。'),
        element: <SharesPage />,
      },
      {
        path: 'audit',
        label: t('审计记录'),
        icon: 'doc-text',
        color: 'var(--system-brown)',
        desc: t('审批、提问、同步事件、管理员操作，永久保存。'),
        element: <AuditPage />,
      },
    ],
  },
]
