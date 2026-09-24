import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aiwsToolList, GetRunArgs, ListMessagesArgs } from '../src/index.js'

describe('aiws tools', () => {
  it('aiws-tools.json (read by the daemon) matches the zod definitions', () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '../aiws-tools.json'), 'utf8'))
    expect(file).toEqual(aiwsToolList())
  })

  it('rejects ambiguous cursors and run references', () => {
    expect(ListMessagesArgs.safeParse({ before: 3, after: 1 }).success).toBe(false)
    expect(ListMessagesArgs.safeParse({ around: 3 }).success).toBe(true)
    expect(GetRunArgs.safeParse({}).success).toBe(false)
    expect(GetRunArgs.safeParse({ message: 3, run: 'r' }).success).toBe(false)
    expect(GetRunArgs.safeParse({ run: 'r' }).success).toBe(true)
  })
})
