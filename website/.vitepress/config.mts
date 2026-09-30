import { defineConfig } from 'vitepress'

const REPO = 'https://github.com/yoqu/gonggong'

export default defineConfig({
  lang: 'zh-CN',
  title: '共工Bot',
  description: '在群里 @ 一下，队友机器上的 Claude Code / Codex 就开工。',
  // GitHub Pages project site: https://<owner>.github.io/gonggong/
  base: process.env.DOCS_BASE ?? '/gonggong/',
  cleanUrls: true,
  srcExclude: ['WRITING.md', 'scripts/**'],
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/gonggong/logo.svg' }]],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: '共工Bot',
    nav: [
      { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: '使用手册', link: '/user/login', activeMatch: '/user/' },
      { text: '桌面端', link: '/desktop/', activeMatch: '/desktop/' },
      { text: '命令行', link: '/cli/', activeMatch: '/cli/' },
      { text: '管理后台', link: '/admin/', activeMatch: '/admin/' },
      { text: '部署运维', link: '/deploy/', activeMatch: '/deploy/' },
      { text: '开发者', link: '/dev/', activeMatch: '/dev/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '共工Bot 是什么', link: '/guide/introduction' },
            { text: '核心概念', link: '/guide/concepts' },
            { text: '系统架构', link: '/guide/architecture' },
            { text: '快速上手', link: '/guide/quick-start' },
          ],
        },
        {
          text: '帮助',
          items: [
            { text: '常见问题与排查', link: '/guide/faq' },
            { text: '术语表', link: '/guide/glossary' },
          ],
        },
      ],
      '/user/': [
        {
          text: '开始使用',
          items: [
            { text: '登录与账号', link: '/user/login' },
            { text: '界面导览', link: '/user/interface' },
            { text: '绑定机器', link: '/user/bind-machine' },
            { text: 'Agent 工具与供应商', link: '/user/agents-providers' },
          ],
        },
        {
          text: 'Bot',
          items: [
            { text: '创建 Bot', link: '/user/create-bot' },
            { text: 'Bot 设置与权限', link: '/user/bot-settings' },
          ],
        },
        {
          text: '群与协作',
          items: [
            { text: '群与私聊', link: '/user/groups' },
            { text: '仓库与工作区', link: '/user/repos-workspaces' },
            { text: '在群里指挥 Bot', link: '/user/chat' },
            { text: '指令参考', link: '/user/commands' },
          ],
        },
        {
          text: '运行与结果',
          items: [
            { text: '运行过程', link: '/user/runs' },
            { text: '代码变更与文件', link: '/user/diff-files' },
            { text: '审批与提问', link: '/user/approvals' },
            { text: '结果预览', link: '/user/previews' },
            { text: '公开分享', link: '/user/shares' },
          ],
        },
        {
          text: '其他',
          items: [
            { text: '通知', link: '/user/notifications' },
            { text: '外观与主题', link: '/user/appearance' },
          ],
        },
      ],
      '/desktop/': [
        {
          text: '桌面端',
          items: [
            { text: '概览与安装', link: '/desktop/' },
            { text: '首次引导', link: '/desktop/onboarding' },
            { text: '功能页面', link: '/desktop/pages' },
            { text: '权限与系统设置', link: '/desktop/permissions' },
          ],
        },
      ],
      '/cli/': [
        {
          text: '命令行 gg',
          items: [
            { text: '安装', link: '/cli/' },
            { text: '命令参考', link: '/cli/reference' },
            { text: '本地数据与日志', link: '/cli/local-data' },
          ],
        },
      ],
      '/admin/': [
        {
          text: '管理后台',
          items: [
            { text: '概览', link: '/admin/' },
            { text: '账号与角色', link: '/admin/users' },
            { text: 'Bot 与群', link: '/admin/bots-groups' },
            { text: '配置中心', link: '/admin/config' },
            { text: '系统参数', link: '/admin/params' },
            { text: '客户端发布', link: '/admin/releases' },
            { text: '机器', link: '/admin/machines' },
            { text: '用量', link: '/admin/usage' },
            { text: '公开链接', link: '/admin/shares' },
            { text: '审计记录', link: '/admin/audit' },
          ],
        },
      ],
      '/deploy/': [
        {
          text: '部署运维',
          items: [
            { text: '部署概览', link: '/deploy/' },
            { text: '从源码部署', link: '/deploy/install' },
            { text: '环境变量', link: '/deploy/env' },
            { text: 'HTTPS 与证书', link: '/deploy/https' },
            { text: '反向代理与预览域名', link: '/deploy/reverse-proxy' },
            { text: '备份与恢复', link: '/deploy/backup' },
            { text: '升级与发布客户端', link: '/deploy/upgrade' },
            { text: '安全模型', link: '/deploy/security' },
          ],
        },
      ],
      '/dev/': [
        {
          text: '开发者',
          items: [
            { text: '参与开发', link: '/dev/' },
            { text: '仓库结构', link: '/dev/structure' },
            { text: '本地开发与测试', link: '/dev/local' },
            { text: '协议', link: '/dev/protocol' },
            { text: '贡献指南', link: '/dev/contributing' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: REPO }],
    editLink: { pattern: `${REPO}/edit/main/website/:path`, text: '在 GitHub 上编辑此页' },
    search: {
      provider: 'local',
      options: {
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
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '外观',
    footer: { copyright: 'Copyright © 2026 共工Bot' },
  },
})
