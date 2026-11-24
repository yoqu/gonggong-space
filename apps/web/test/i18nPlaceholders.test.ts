import { protocolEn } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en'

/** Keys whose English deliberately leaves out a placeholder, with why. */
const EXEMPT: Record<string, string> = {
  // The English names the people not listed ({more}), not the total.
  '{names} 等 {n} 人': 'n',
}

function droppedPlaceholders(dict: Record<string, string>, exempt: Record<string, string> = {}) {
  return Object.entries(dict).flatMap(([key, value]) =>
    [...new Set([...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))]
      .filter((p) => !value.includes(`{${p}}`) && !exempt[key]?.split(',').includes(p))
      .map((p) => `${key} => ${value} (missing {${p}})`),
  )
}

const LEAF_DICTS = import.meta.glob<{ default: Record<string, string> }>(
  [
    '../src/app/en.ts',
    '../src/lib/en.ts',
    '../src/ui/en.ts',
    '../src/features/**/en*.ts',
    '!../src/features/artifacts/en.ts',
  ],
  { eager: true },
)

describe('English dictionary', () => {
  it('keeps every placeholder of the Chinese source as a bare {x}', () => {
    expect(droppedPlaceholders(en, EXEMPT)).toEqual([])
  })

  it('has no conflicting translations across modules', () => {
    const seen = new Map<string, { source: string; value: string }>()
    const conflicts: string[] = []
    const check = (source: string, dict: Record<string, string>) => {
      for (const [key, value] of Object.entries(dict)) {
        const prev = seen.get(key)
        if (prev && prev.value !== value) {
          conflicts.push(`${key}: ${prev.source} (${prev.value}) vs ${source} (${value})`)
        } else {
          seen.set(key, { source, value })
        }
      }
    }
    check('@gonggong/protocol', protocolEn)
    for (const [path, mod] of Object.entries(LEAF_DICTS).sort(([a], [b]) => a.localeCompare(b))) {
      check(path, mod.default)
    }
    expect(conflicts).toEqual([])
  })

  it('leaves no CJK characters or CJK punctuation in English values', () => {
    const leaks = Object.entries(en)
      .filter(([, value]) => /[\u4e00-\u9fff「」【】、，。]/.test(value))
      .map(([key, value]) => `${key} => ${value}`)
    expect(leaks).toEqual([])
  })

  it('uses American English spelling consistently', () => {
    const uk = Object.entries(en)
      .filter(([, value]) => /\b(colours?|favourit\w*|cancelled)\b/i.test(value))
      .map(([key, value]) => `${key} => ${value}`)
    expect(uk).toEqual([])
  })

  it('uses straight quotes in English values and avoids stray leading/trailing spaces', () => {
    const AFFIX_EXEMPT = new Set([
      '、',
      '：',
      '；',
      '，',
      '。',
      '[待审批] ',
      '[待回答] ',
      '[加急] ',
      '[有人@我] ',
      '[草稿] ',
      ' · 点击预览',
      ' · 服务 {name}',
      ' · 端口 {port}',
      ' · 中位 {h} 小时',
      ' · 主人将一并加入',
      ' · 本群',
      ' / {size} token',
      ' 等 {n} 人',
      '（Bot 主人自动加入）',
      '（我）',
      '（含接力链，整条链终止）',
      '（{owner} 批准）',
      '（落后 {n} 个提交）',
      '（在新窗口打开）',
      '（已编辑）',
      '仅你和你的 Bot · ',
      '{owner} 共享的 Bot · ',
      '引用：',
      '与',
    ])
    const issues = Object.entries(en)
      .filter(([key, value]) => /[’‘“”]/.test(value) || (!AFFIX_EXEMPT.has(key) && value !== value.trim()))
      .map(([key, value]) => `${key} => ${JSON.stringify(value)}`)
    expect(issues).toEqual([])
  })
})
