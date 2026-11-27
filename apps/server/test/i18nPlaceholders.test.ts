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
    const sources = [
      'schedules.ts',
      'web/admin.ts',
      'web/groups.ts',
      'secrets.ts',
      'plugins.ts',
      'artifact-states.ts',
      'artifact-manifest.ts',
    ]
    const missing: string[] = []
    for (const rel of sources) {
      const text = readFileSync(join(protoDir, rel), 'utf8')
      for (const m of text.matchAll(
        /(?:message:[ \t]*|,[ \t]*|URL\.canParse\(u\),\s*)'([^'\n]*[\u4e00-\u9fff][^'\n]*)'/g,
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

  it('has no CJK characters in any English translation', () => {
    const leaks = Object.entries(en as Record<string, string>).filter(([, value]) => /[一-鿿]/.test(value))
    expect(leaks).toEqual([])
  })

  it('uses adopted terminology and copy for Slice E keys', () => {
    const dict = en as Record<string, string>
    expect(dict['这个 Bot 暂不支持创作作品，请从列表里选择可用的 Bot']).toBe(
      "This Bot can't create works yet; choose an available Bot from the list",
    )
    expect(dict.缺少电脑登录凭据).toBe('Missing computer credentials')
    expect(dict['电脑登录已失效，请重新绑定']).toBe('Computer sign-in expired; bind again')
    expect(dict.这台电脑不能上传这个网页).toBe('This computer may not upload this site')
    expect(dict.私聊不能关联飞书群).toBe("A direct chat can't be linked to a Feishu chat")
    expect(dict['基准 Bot 使用本机目录，不能作为基准']).toBe(
      'The base Bot uses a local folder and cannot be the base',
    )
    expect(dict.冲突不存在或已处理).toBe('The conflict does not exist or was already resolved')
  })
})
