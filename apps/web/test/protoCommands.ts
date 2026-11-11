import type { ArtifactPluginCommandDto } from '@gonggong/protocol'

/** GET /artifacts/:id/commands of a 产品原型 artifact: the official plugin's canvas commands. */
export const PROTO_COMMANDS: ArtifactPluginCommandDto[] = [
  {
    name: 'instant-prototype',
    title: '连成可点击原型',
    description: '给可点元素补上跳转，连成可点击原型',
    needsScreen: false,
  },
  {
    name: 'desktop-version',
    title: '生成桌面网页版',
    description: '为选中的屏幕各生成一个桌面端版本',
    needsScreen: true,
  },
  {
    name: 'missing-states',
    title: '补全状态',
    description: '补齐空状态、加载中、出错等状态',
    needsScreen: true,
  },
  {
    name: 'app-store-assets',
    title: '生成应用商店素材',
    description: '上架截图与应用图标',
    needsScreen: false,
  },
  { name: 'web-assets', title: '生成网页素材', description: '横幅、分享图与 favicon', needsScreen: false },
  { name: 'marketing-kit', title: '生成营销物料', description: '海报、社交配图与横幅', needsScreen: false },
  {
    name: 'accessibility-audit',
    title: '无障碍检查',
    description: '检查并修复选中屏幕的无障碍问题',
    needsScreen: true,
  },
  {
    name: 'project-brief',
    title: '撰写产品需求文档',
    description: '根据当前产物写一份 PRD',
    needsScreen: false,
  },
]
