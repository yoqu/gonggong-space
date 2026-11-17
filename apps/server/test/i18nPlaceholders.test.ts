import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { protocolEn } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import { en as serverEn } from '../src/i18n/en.js'

const en = { ...protocolEn, ...serverEn }

describe('English dictionary', () => {
  it('keeps every placeholder of the Chinese source as a bare {x}', () => {
    const dropped = Object.entries(en as Record<string, string>).flatMap(([key, value]) =>
      [...new Set([...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
        .filter((p) => !value.includes(`{${p}}`))
        .map((p) => `${key} => ${value} (missing {${p}})`),
    )
    expect(dropped).toEqual([])
  })

  it('covers static Zod validation messages from request schemas', () => {
    const protoDir = join(import.meta.dirname, '../../../packages/protocol/src')
    const sources = ['schedules.ts', 'web/admin.ts', 'web/groups.ts']
    const missing: string[] = []
    for (const rel of sources) {
      const text = readFileSync(join(protoDir, rel), 'utf8')
      for (const m of text.matchAll(
        /(?:message:[ \t]*|,[ \t]*|URL\.canParse\(u\),\s*)'([^']*[\u4e00-\u9fff][^']*)'/g,
      )) {
        const msg = m[1] ?? ''
        if (!(msg in en)) missing.push(`${rel}: ${msg}`)
      }
    }
    for (const msg of ['文件不能超过 200 KB', 'tokens.css 只能包含令牌声明、注释和 .t-* 文字样式']) {
      if (!(msg in en)) missing.push(`artifacts.ts: ${msg}`)
    }
    expect(missing).toEqual([])
  })
})
