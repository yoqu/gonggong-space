import { describe, expect, it } from 'vitest'
import {
  BotCapabilitiesDto,
  derivePluginCapabilities,
  derivePluginExamples,
  derivePluginFeatured,
  derivePluginReadiness,
  derivePluginScene,
  extractFrontmatterExamples,
  extractFrontmatterScene,
  isMarketHiddenCategory,
  MarketInstalledDto,
  MarketListingDetailDto,
  MarketListingDto,
  MarketReadinessActionReq,
  MarketReadinessDto,
  PluginManifest,
  SkillListingManifest,
} from '../src/index.js'

const baseManifest = {
  name: 'sample-plugin',
  version: '1.0.0',
  title: '样例插件',
  description: '通用辅助工具',
  category: 'tool' as const,
  agents: ['claude' as const],
  minDaemon: '0.5.0',
  entry: 'sample-plugin',
}

describe('market scene/capability/readiness derivation', () => {
  it('hides agent and provider categories from default Plugin Market', () => {
    expect(isMarketHiddenCategory('agent')).toBe(true)
    expect(isMarketHiddenCategory('provider')).toBe(true)
    expect(isMarketHiddenCategory('connector')).toBe(false)
    expect(isMarketHiddenCategory('web')).toBe(false)
    expect(isMarketHiddenCategory('tool')).toBe(false)
    expect(isMarketHiddenCategory(null)).toBe(false)
    expect(isMarketHiddenCategory(undefined)).toBe(false)
  })

  it('derives scene deterministically from category, MCP, keywords, and explicit override', () => {
    expect(derivePluginScene({ category: 'connector' })).toBe('connect')
    expect(derivePluginScene({ category: 'web' })).toBe('create')
    expect(derivePluginScene({ category: 'deck' })).toBe('create')
    expect(derivePluginScene({ category: 'dashboard' })).toBe('create')
    expect(derivePluginScene({ category: 'video' })).toBe('create')
    expect(derivePluginScene({ category: 'tool', contributes: { mcp: [{ name: 'api' }] } })).toBe('connect')
    expect(derivePluginScene({ type: 'skill', name: 'code-review', description: '代码审查工具' })).toBe('dev')
    expect(derivePluginScene({ type: 'skill', name: 'weekly-report', description: '写周报助手' })).toBe(
      'office',
    )
    expect(derivePluginScene({ type: 'skill', name: 'feishu-sync', description: '连接飞书' })).toBe('connect')
    expect(derivePluginScene({ type: 'skill', name: 'helper', description: '快捷小工具' })).toBe('tools')
    // Explicit override always wins.
    expect(derivePluginScene({ category: 'connector', scene: 'office' })).toBe('office')
  })

  it('derives capabilities (do / connect / create) accurately with manifest override support', () => {
    expect(derivePluginCapabilities({ type: 'plugin', category: 'web', entry: 'web-prototype' })).toEqual([
      'create',
    ])
    expect(
      derivePluginCapabilities({
        type: 'plugin',
        category: 'web',
        entry: 'web-prototype',
        contributes: { commands: [{ where: 'artifact' }] },
      }),
    ).toEqual(['create'])
    expect(
      derivePluginCapabilities({
        type: 'plugin',
        category: 'connector',
        entry: 'feishu',
        connector: { examples: [] },
      }),
    ).toEqual(['connect'])
    expect(
      derivePluginCapabilities({
        type: 'plugin',
        category: 'connector',
        entry: 'dw',
        connector: { examples: [] },
        contributes: { commands: [{ where: 'chat' }] },
      }),
    ).toEqual(['connect', 'do'])
    expect(
      derivePluginCapabilities({
        type: 'plugin',
        category: 'tool',
        entry: 'dw',
        contributes: { mcp: [{ name: 'dw' }], commands: [{ where: 'chat' }] },
      }),
    ).toEqual(['connect', 'do'])
    expect(derivePluginCapabilities({ type: 'skill', name: 'review' })).toEqual(['do'])
    expect(derivePluginCapabilities({ capabilities: ['create', 'do', 'create'] })).toEqual(['create', 'do'])
  })

  it('derives readiness hint with priority needs-account > needs-secret > needs-trust > ready', () => {
    expect(derivePluginReadiness({ connector: { examples: [], login: '帮我连接飞书' } })).toBe(
      'needs-account',
    )
    expect(
      derivePluginReadiness({
        connector: { examples: [], cli: { driver: 'lark-cli', npm: '@larksuite/cli', urlHosts: [] } },
        permissions: ['exec'],
      }),
    ).toBe('needs-account')
    expect(
      derivePluginReadiness({
        secretSpecs: [{ name: 'DW_KEY', description: '', mode: 'personal', required: true }],
        permissions: ['exec'],
      }),
    ).toBe('needs-secret')
    expect(
      derivePluginReadiness({
        secretSpecs: [{ name: 'OPT_KEY', description: '', mode: 'shared', required: false }],
        permissions: ['exec'],
      }),
    ).toBe('needs-trust')
    expect(
      derivePluginReadiness({
        secretSpecs: [{ name: 'OPT_KEY', description: '', mode: 'shared', required: false }],
        permissions: [],
      }),
    ).toBe('ready')
  })

  it('extracts scene and examples from SKILL.md frontmatter and manifest', () => {
    const md = [
      '---',
      'name: weekly-report',
      'description: 自动整理周报',
      'scene: office',
      'examples:',
      '  - "汇总本周群聊进展并生成周报"',
      "  - '列出下周关键里程碑'",
      '---',
      '# 周报助手',
    ].join('\n')
    expect(extractFrontmatterScene(md)).toBe('office')
    expect(extractFrontmatterExamples(md)).toEqual(['汇总本周群聊进展并生成周报', '列出下周关键里程碑'])

    const inlineMd = '---\nname: x\nexamples: ["一", "二"]\n---\nbody'
    expect(extractFrontmatterExamples(inlineMd)).toEqual(['一', '二'])
    expect(derivePluginExamples({}, md)).toEqual(['汇总本周群聊进展并生成周报', '列出下周关键里程碑'])
    expect(
      derivePluginExamples({ examples: ['直接示例'], connector: { examples: ['连接器示例'] } }, md),
    ).toEqual(['直接示例'])
    expect(derivePluginExamples({ connector: { examples: ['查日程'] } }, md)).toEqual(['查日程'])
  })

  it('derives featured flag for official flagship plugins and respects overrides', () => {
    expect(derivePluginFeatured({ layer: 'platform', name: 'web-prototype', category: 'web' })).toBe(true)
    expect(derivePluginFeatured({ source: 'official', name: 'feishu', category: 'connector' })).toBe(true)
    expect(derivePluginFeatured({ source: 'team', name: 'web-prototype', category: 'web' })).toBe(false)
    expect(derivePluginFeatured({ source: 'official', name: 'agent-gemini', category: 'agent' })).toBe(false)
    expect(derivePluginFeatured({ source: 'team', name: 'custom', featured: true })).toBe(true)
    expect(derivePluginFeatured({ source: 'official', name: 'web-prototype', featured: false })).toBe(false)
  })
})

describe('new manifest and DTO schemas', () => {
  it('accepts optional scene, capabilities, examples, featured in PluginManifest and SkillListingManifest', () => {
    const m = PluginManifest.parse({
      ...baseManifest,
      scene: 'dev',
      capabilities: ['do', 'connect'],
      examples: ['帮我查昨天的新增注册'],
      featured: true,
    })
    expect(m.scene).toBe('dev')
    expect(m.capabilities).toEqual(['do', 'connect'])
    expect(m.examples).toEqual(['帮我查昨天的新增注册'])
    expect(m.featured).toBe(true)

    const s = SkillListingManifest.parse({
      name: 'review',
      description: '代码审查',
      scene: 'dev',
      examples: ['审查本次改动'],
    })
    expect(s.scene).toBe('dev')
    expect(s.examples).toEqual(['审查本次改动'])
  })

  it('parses MarketListingDto, MarketListingDetailDto, MarketInstalledDto, MarketReadinessDto, and BotCapabilitiesDto', () => {
    const listing = MarketListingDto.parse({
      id: 'l1',
      type: 'plugin',
      name: 'dw-query',
      title: '数仓查询',
      description: '用自然语言查数仓',
      layer: 'team',
      status: 'listed',
      versionId: 'v1',
      revision: 1,
      icon: null,
      category: 'connector',
      source: 'team',
      visibility: 'team',
      teamId: 't1',
      teamName: '研发组',
      author: '张磊',
      agents: ['claude'],
      listedVersionId: 'v1',
      listedRevision: 1,
      installs: 3,
      scene: 'connect',
      capabilities: ['connect', 'do'],
      readiness: 'needs-secret',
      featured: false,
      examples: ['查昨日注册'],
      teamGroupsCount: 2,
      permissions: ['network'],
      updatedAt: '2026-11-27T00:00:00.000Z',
    })
    expect(listing.scene).toBe('connect')

    const detail = MarketListingDetailDto.parse({
      ...listing,
      readme: '# 数仓查询',
      files: [],
      versions: [],
      ghSource: null,
      canEdit: false,
      reusedSecrets: [
        {
          name: 'DW_KEY',
          existingScope: 'group',
          existingScopeLabel: '产品讨论群',
          targetLabel: '产品讨论群',
        },
      ],
    })
    expect(detail.reusedSecrets?.[0]?.name).toBe('DW_KEY')

    const installed = MarketInstalledDto.parse({
      todoCount: 1,
      pendingUpdates: 0,
      mine: [],
      groups: [],
      team: [],
    })
    expect(installed.todoCount).toBe(1)

    const readiness = MarketReadinessDto.parse({
      listingId: 'l1',
      title: '数仓查询',
      versionId: 'v1',
      scope: 'group',
      scopeId: 'g1',
      targetLabel: '产品讨论群',
      ready: false,
      pendingSteps: 1,
      secrets: [],
      reusedSecrets: [],
      connector: null,
      trusts: null,
      tryPrompts: ['查昨日注册'],
    })
    expect(readiness.pendingSteps).toBe(1)
    expect(MarketReadinessActionReq.parse({ action: 'allow_trust', machineId: 'm1' }).action).toBe(
      'allow_trust',
    )

    const caps = BotCapabilitiesDto.parse({
      botId: 'b1',
      groupId: 'g1',
      groups: [{ id: 'g1', name: '产品讨论群' }],
      pluginsEnabled: true,
      ready: [],
      unavailable: [],
    })
    expect(caps.botId).toBe('b1')
  })
})
