import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  daemonToolList,
  GetRunArgs,
  gonggongToolList,
  ListMessagesArgs,
  PreviewExposeArgs,
  PreviewMiniprogramArgs,
  ServiceStartArgs,
} from '../src/index.js'

const read = (file: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', file), 'utf8'))

describe('gonggong tools', () => {
  it('gonggong-tools.json (read by the daemon) matches the zod definitions', () => {
    expect(read('gonggong-tools.json')).toEqual(gonggongToolList())
  })

  it('gonggong-daemon-tools.json (answered by the daemon) matches the zod definitions', () => {
    expect(read('gonggong-daemon-tools.json')).toEqual(daemonToolList())
  })

  it('rejects ambiguous cursors and run references', () => {
    expect(ListMessagesArgs.safeParse({ before: 3, after: 1 }).success).toBe(false)
    expect(ListMessagesArgs.safeParse({ around: 3 }).success).toBe(true)
    expect(GetRunArgs.safeParse({}).success).toBe(false)
    expect(GetRunArgs.safeParse({ message: 3, run: 'r' }).success).toBe(false)
    expect(GetRunArgs.safeParse({ run: 'r' }).success).toBe(true)
  })

  it('previews name exactly one target and a root-relative path', () => {
    expect(PreviewExposeArgs.safeParse({ title: 'a' }).success).toBe(false)
    expect(PreviewExposeArgs.safeParse({ title: 'a', port: 5173, service: 'web' }).success).toBe(false)
    expect(PreviewExposeArgs.safeParse({ title: 'a', port: 5173 }).success).toBe(true)
    expect(PreviewExposeArgs.safeParse({ title: 'a', service: 'web', path: 'x' }).success).toBe(false)
    expect(PreviewExposeArgs.safeParse({ title: 'a', service: 'web', path: '/x?y=1' }).success).toBe(true)
    expect(PreviewExposeArgs.safeParse({ title: 'a', miniprogram: '/w/shop' }).success).toBe(true)
    expect(PreviewExposeArgs.safeParse({ title: 'a', miniprogram: '/w/shop', port: 1 }).success).toBe(false)
  })

  it('mini program previews name a page relative to the project', () => {
    expect(PreviewMiniprogramArgs.safeParse({ title: 'a' }).success).toBe(true)
    expect(
      PreviewMiniprogramArgs.safeParse({ title: 'a', page: 'pages/index/index', query: 'id=1' }).success,
    ).toBe(true)
    expect(PreviewMiniprogramArgs.safeParse({ title: 'a', page: '/pages/index/index' }).success).toBe(false)
    expect(PreviewMiniprogramArgs.safeParse({ title: 'a', page: 'pages/a', query: '?id=1' }).success).toBe(
      false,
    )
  })

  it('service names are short slugs', () => {
    expect(ServiceStartArgs.safeParse({ name: 'web-1', command: 'pnpm dev' }).success).toBe(true)
    expect(ServiceStartArgs.safeParse({ name: 'Web', command: 'x' }).success).toBe(false)
    expect(ServiceStartArgs.safeParse({ name: '../x', command: 'x' }).success).toBe(false)
    expect(ServiceStartArgs.safeParse({ name: 'web', command: '' }).success).toBe(false)
  })
})
