import { fileURLToPath } from 'node:url'
import { type DefaultTheme, defineConfig } from 'vitepress'

const REPO = 'https://github.com/yoqu/gonggong-space'

type Lang = 'zh' | 'en'
type Item = [link: string, zh: string, en: string]
type Group = { zh: string; en: string; items: Item[] }

// One table drives both locales; English pages live under /en/ with the same paths.
const SECTIONS: { base: string; nav: [string, string]; groups: Group[] }[] = [
  {
    base: '/guide/',
    nav: ['指南', 'Guide'],
    groups: [
      {
        zh: '入门',
        en: 'Getting Started',
        items: [
          ['/guide/introduction', '共工空间是什么', 'What is Gonggong Space'],
          ['/guide/concepts', '核心概念', 'Core Concepts'],
          ['/guide/architecture', '系统架构', 'Architecture'],
          ['/guide/quick-start', '快速上手', 'Quick Start'],
        ],
      },
      {
        zh: '帮助',
        en: 'Help',
        items: [
          ['/guide/faq', '常见问题与排查', 'FAQ & Troubleshooting'],
          ['/guide/glossary', '术语表', 'Glossary'],
        ],
      },
    ],
  },
  {
    base: '/user/',
    nav: ['使用手册', 'User Guide'],
    groups: [
      {
        zh: '开始使用',
        en: 'Getting Started',
        items: [
          ['/user/login', '登录与账号', 'Sign-in & Account'],
          ['/user/interface', '界面导览', 'Interface Tour'],
          ['/user/bind-machine', '绑定机器', 'Binding a Machine'],
          ['/user/agents-providers', 'Agent 工具与供应商', 'Agent Tools & Providers'],
        ],
      },
      {
        zh: 'Bot',
        en: 'Bots',
        items: [
          ['/user/create-bot', '创建 Bot', 'Creating a Bot'],
          ['/user/bot-settings', 'Bot 设置与权限', 'Bot Settings & Permissions'],
        ],
      },
      {
        zh: '群与协作',
        en: 'Groups & Collaboration',
        items: [
          ['/user/groups', '群与私聊', 'Groups & Direct Chats'],
          ['/user/repos-workspaces', '仓库与工作区', 'Repositories & Workspaces'],
          ['/user/chat', '在群里指挥 Bot', 'Directing Bots in a Group'],
          ['/user/commands', '指令参考', 'Command Reference'],
        ],
      },
      {
        zh: '运行与结果',
        en: 'Runs & Results',
        items: [
          ['/user/runs', '运行过程', 'Runs'],
          ['/user/diff-files', '代码变更与文件', 'Diffs & Files'],
          ['/user/approvals', '审批与提问', 'Approvals & Questions'],
          ['/user/previews', '结果预览', 'Previews'],
          ['/user/shares', '公开分享', 'Public Sharing'],
        ],
      },
      {
        zh: '其他',
        en: 'More',
        items: [
          ['/user/notifications', '通知', 'Notifications'],
          ['/user/appearance', '外观与主题', 'Appearance & Themes'],
        ],
      },
    ],
  },
  {
    base: '/desktop/',
    nav: ['桌面端', 'Desktop'],
    groups: [
      {
        zh: '桌面端',
        en: 'Desktop App',
        items: [
          ['/desktop/', '概览与安装', 'Overview & Installation'],
          ['/desktop/onboarding', '首次引导', 'First-run Setup'],
          ['/desktop/pages', '功能页面', 'Pages'],
          ['/desktop/permissions', '权限与系统设置', 'Permissions & System Settings'],
        ],
      },
    ],
  },
  {
    base: '/cli/',
    nav: ['命令行', 'CLI'],
    groups: [
      {
        zh: '命令行 gg',
        en: 'The gg CLI',
        items: [
          ['/cli/', '安装', 'Installation'],
          ['/cli/reference', '命令参考', 'Command Reference'],
          ['/cli/local-data', '本地数据与日志', 'Local Data & Logs'],
        ],
      },
    ],
  },
  {
    base: '/admin/',
    nav: ['管理后台', 'Admin'],
    groups: [
      {
        zh: '管理后台',
        en: 'Admin Console',
        items: [
          ['/admin/', '概览', 'Overview'],
          ['/admin/users', '账号与角色', 'Accounts & Roles'],
          ['/admin/bots-groups', 'Bot 与群', 'Bots & Groups'],
          ['/admin/config', '配置中心', 'Configuration Center'],
          ['/admin/params', '系统参数', 'System Parameters'],
          ['/admin/releases', '客户端发布', 'Client Releases'],
          ['/admin/machines', '机器', 'Machines'],
          ['/admin/usage', '用量', 'Usage'],
          ['/admin/shares', '公开链接', 'Public Links'],
          ['/admin/audit', '审计记录', 'Audit Log'],
        ],
      },
    ],
  },
  {
    base: '/deploy/',
    nav: ['部署运维', 'Deployment'],
    groups: [
      {
        zh: '部署运维',
        en: 'Deployment',
        items: [
          ['/deploy/', '部署概览', 'Overview'],
          ['/deploy/install', '从源码部署', 'Deploy from Source'],
          ['/deploy/env', '环境变量', 'Environment Variables'],
          ['/deploy/https', 'HTTPS 与证书', 'HTTPS & Certificates'],
          ['/deploy/reverse-proxy', '反向代理与预览域名', 'Reverse Proxy & Preview Domain'],
          ['/deploy/backup', '备份与恢复', 'Backup & Restore'],
          ['/deploy/upgrade', '升级与发布客户端', 'Upgrades & Client Releases'],
          ['/deploy/security', '安全模型', 'Security Model'],
        ],
      },
    ],
  },
  {
    base: '/dev/',
    nav: ['开发者', 'Developers'],
    groups: [
      {
        zh: '开发者',
        en: 'Developers',
        items: [
          ['/dev/', '参与开发', 'Contributing Overview'],
          ['/dev/structure', '仓库结构', 'Repository Layout'],
          ['/dev/local', '本地开发与测试', 'Local Development & Testing'],
          ['/dev/protocol', '协议', 'Protocols'],
          ['/dev/contributing', '贡献指南', 'Contribution Guide'],
        ],
      },
    ],
  },
]

const prefix = (lang: Lang) => (lang === 'en' ? '/en' : '')

const nav = (lang: Lang): DefaultTheme.NavItem[] =>
  SECTIONS.map((s) => ({
    text: s.nav[lang === 'en' ? 1 : 0],
    link: prefix(lang) + s.groups[0].items[0][0],
    activeMatch: prefix(lang) + s.base,
  }))

const sidebar = (lang: Lang): DefaultTheme.SidebarMulti =>
  Object.fromEntries(
    SECTIONS.map((s) => [
      prefix(lang) + s.base,
      s.groups.map((g) => ({
        text: g[lang],
        items: g.items.map(([link, zh, en]) => ({
          text: lang === 'en' ? en : zh,
          link: prefix(lang) + link,
        })),
      })),
    ]),
  )

const editLink = (text: string) => ({ pattern: `${REPO}/edit/main/website/:path`, text })

export default defineConfig({
  title: '共工空间',
  // GitHub Pages project site: https://<owner>.github.io/gonggong-space/
  base: process.env.DOCS_BASE ?? '/gonggong-space/',
  cleanUrls: true,
  srcExclude: ['WRITING.md', 'TRANSLATING.md', 'scripts/**'],
  lastUpdated: true,
  // The home page borrows the web app's personas, which import the protocol package; CI installs only the website,
  // so resolve it here rather than from apps/web/node_modules.
  vite: {
    resolve: {
      alias: { '@gonggong/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url)) },
    },
  },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/gonggong-space/logo.svg' }]],
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      description: '在群里 @ 一下，队友机器上的 Claude Code / Codex 就开工。',
      themeConfig: {
        siteTitle: '共工空间',
        nav: nav('zh'),
        sidebar: sidebar('zh'),
        editLink: editLink('在 GitHub 上编辑此页'),
        outline: { level: [2, 3], label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新' },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '外观',
        langMenuLabel: '切换语言',
        footer: { message: '基于 Apache License 2.0 开源', copyright: 'Copyright © 2026 共工空间' },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'Gonggong Space',
      description:
        'Mention a Bot in a group chat, and Claude Code / Codex gets to work on a teammate’s machine.',
      themeConfig: {
        siteTitle: 'Gonggong Space',
        nav: nav('en'),
        sidebar: sidebar('en'),
        editLink: editLink('Edit this page on GitHub'),
        outline: { level: [2, 3] },
        footer: {
          message: 'Released under the Apache License 2.0',
          copyright: 'Copyright © 2026 Gonggong Space',
        },
      },
    },
  },
  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [{ icon: 'github', link: REPO }],
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                noResultsText: '没有找到相关结果',
                resetButtonTitle: '清除',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
})
