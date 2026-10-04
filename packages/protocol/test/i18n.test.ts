import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator, protocolEn, resolveLocale } from '../src/index.js'

describe('i18n', () => {
  it('resolves locale tags, defaulting to Chinese', () => {
    expect(resolveLocale(undefined)).toBe('zh')
    expect(resolveLocale('')).toBe('zh')
    expect(resolveLocale('C.UTF-8')).toBe('zh')
    expect(resolveLocale('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh')
    expect(resolveLocale('en-US,en;q=0.9')).toBe('en')
    expect(resolveLocale('ja-JP')).toBe('en')
  })

  it('translates with params, plurals and nested texts', () => {
    const en = {
      '共 {n} 条': '{n} {n:item|items}',
      '{user} 将档位设为「{tier}」': '{user} set the tier to "{tier}"',
      只读: 'Read-only',
    }
    const t = createTranslator('en', en)
    expect(t('共 {n} 条', { n: 1 })).toBe('1 item')
    expect(t('共 {n} 条', { n: 3 })).toBe('3 items')
    expect(t('{user} 将档位设为「{tier}」', { user: 'Ann', tier: { key: '只读' } })).toBe(
      'Ann set the tier to "Read-only"',
    )
    const zh = createTranslator('zh', en)
    expect(zh('{user} 将档位设为「{tier}」', { user: 'Ann', tier: { key: '只读' } })).toBe(
      'Ann 将档位设为「只读」',
    )
    expect(t.text({ key: '未收录' })).toBe('未收录')
  })

  it('tells apart identical sources by a context suffix', () => {
    const en = { 关闭: 'Close', '关闭#off': 'Off' }
    expect(createTranslator('en', en)('关闭#off')).toBe('Off')
    expect(createTranslator('zh', en)('关闭#off')).toBe('关闭')
    expect(createTranslator('en', {}).text({ key: '关闭#off' })).toBe('关闭')
  })

  it('has English for every sync failure reason the daemon sends as a template', () => {
    const root = join(import.meta.dirname, '../../../crates/gonggong/src')
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.rs') && f !== 'i18n.rs',
    )
    const keys = files.flatMap((f) =>
      [...readFileSync(join(root, f), 'utf8').matchAll(/\breason!\(\s*"((?:[^"\\]|\\.)*)"/g)].map(
        (m) => m[1] ?? '',
      ),
    )
    expect(keys).toContain('疑似密钥文件 {path}，未被 git 跟踪，请加入 .gitignore 或移出工作区')
    expect(keys.filter((k) => !(k in protocolEn))).toEqual([])
    const t = createTranslator('en', protocolEn)
    expect(t.text({ key: '{path} 是符号链接，不能同步', params: { path: 'a' } })).toBe(
      "a is a symbolic link and can't be synced",
    )
  })
})
