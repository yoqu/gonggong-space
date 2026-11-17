import { describe, expect, it } from 'vitest'
import {
  ArtifactEditOp,
  ArtifactRuleFile,
  BridgeFromShell,
  formatRules,
  GgArtifactManifest,
  parseRules,
  parseSharedRules,
  ruleFileOf,
  SHARED_RULES_FILE,
  sharedRefsOf,
} from '../src/index.js'

const PAGE = `# 退款申请 · 页面规则

1. **退款原因** \`#reason\`：未选择时「提交申请」置灰
2. **退款金额** \`#amount\` [待确认]：部分退款出现小数如何取整？
   建议四舍五入到分
3. **整页** [待确认]：家庭成员能否申请退款？
4. 成功后进入「退款审核中」（见 S1、S3）
`

describe('page rules', () => {
  it('parses numbered items with label, anchor, pending and continuation lines', () => {
    const { title, rules } = parseRules(PAGE)
    expect(title).toBe('退款申请 · 页面规则')
    expect(rules).toEqual([
      { label: '退款原因', anchor: 'reason', pending: false, text: '未选择时「提交申请」置灰' },
      {
        label: '退款金额',
        anchor: 'amount',
        pending: true,
        text: '部分退款出现小数如何取整？\n建议四舍五入到分',
      },
      { label: '整页', anchor: null, pending: true, text: '家庭成员能否申请退款？' },
      { label: null, anchor: null, pending: false, text: '成功后进入「退款审核中」（见 S1、S3）' },
    ])
  })

  it('round-trips through formatRules', () => {
    const parsed = parseRules(PAGE)
    expect(parseRules(formatRules(parsed.title, parsed.rules))).toEqual(parsed)
  })

  it('finds shared rule references', () => {
    expect(sharedRefsOf('见 S1、S3，再看 S1')).toEqual(['S1', 'S3'])
    expect(sharedRefsOf('SS1 无')).toEqual([])
  })

  it('splits shared rules into sections', () => {
    const md = '# 共享规则\n\n## S1 订单状态流转\n| a |\n\n## S2 角色权限\n- x\n'
    expect(parseSharedRules(md)).toEqual([
      { id: 'S1', title: '订单状态流转', body: '| a |' },
      { id: 'S2', title: '角色权限', body: '- x' },
    ])
  })

  it('names rule files', () => {
    expect(ruleFileOf('refund-apply')).toBe('rules/refund-apply.md')
    expect(ArtifactRuleFile.safeParse(SHARED_RULES_FILE).success).toBe(true)
    expect(ArtifactRuleFile.safeParse('rules/../x.md').success).toBe(false)
  })

  it('edits rule files whole and anchors elements', () => {
    expect(ArtifactEditOp.safeParse({ kind: 'file', path: 'rules/a.md', content: PAGE }).success).toBe(true)
    expect(ArtifactEditOp.safeParse({ kind: 'file', path: 'rules/a.txt', content: '' }).success).toBe(false)
    const at = { kind: 'attr', file: 'screens/a.html', ggId: '12', name: 'data-gg-anchor' }
    expect(ArtifactEditOp.safeParse({ ...at, value: 'reason' }).success).toBe(true)
    expect(ArtifactEditOp.safeParse({ ...at, value: 'Bad Anchor' }).success).toBe(false)
  })

  it('bridge reports anchor rects', () => {
    const msg = {
      source: 'gg-bridge',
      file: 'screens/a.html',
      type: 'size',
      width: 375,
      height: 800,
      anchors: [{ anchor: 'reason', ggId: '12', rect: { x: 0, y: 0, w: 10, h: 10 } }],
    }
    expect(BridgeFromShell.safeParse(msg).success).toBe(true)
  })
})

describe('link nodes', () => {
  const base = {
    title: 't',
    device: 'mobile',
    entry: 'a',
    screens: [{ id: 'a', title: 'A', file: 'screens/a.html' }],
  }
  const link = {
    id: 'prd',
    url: 'https://x.feishu.cn/docx/abc',
    title: '退款 PRD',
    display: 'embed',
    ratio: '4:3',
  }

  it('lives in the manifest', () => {
    expect(
      GgArtifactManifest.safeParse({ ...base, links: [{ ...link, w: 480, x: 10, y: 20 }] }).success,
    ).toBe(true)
    expect(
      GgArtifactManifest.safeParse({ ...base, links: [{ ...link, url: 'javascript:alert(1)' }] }).success,
    ).toBe(false)
    expect(GgArtifactManifest.safeParse({ ...base, links: [link, link] }).success).toBe(false)
  })

  it('has add, update, move and delete ops', () => {
    const { id: _, ...add } = link
    expect(ArtifactEditOp.safeParse({ kind: 'link', ...add }).success).toBe(true)
    expect(
      ArtifactEditOp.safeParse({ kind: 'link-update', id: 'prd', ratio: 'free', w: 600, h: 400 }).success,
    ).toBe(true)
    expect(ArtifactEditOp.safeParse({ kind: 'link-move', id: 'prd', x: 1, y: 2 }).success).toBe(true)
    expect(ArtifactEditOp.safeParse({ kind: 'link-delete', id: 'prd' }).success).toBe(true)
  })
})
