import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CastInput } from '../src/index.js'

const cases: { valid: unknown[]; invalid: unknown[] } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../cases/cast-input.json'), 'utf8'),
)

describe('cast input (shared with gg-cast)', () => {
  it.each(cases.valid)('accepts %j', (c) => {
    expect(CastInput.parse(c)).toEqual(c)
  })
  it.each(cases.invalid)('rejects %j', (c) => {
    expect(CastInput.safeParse(c).success).toBe(false)
  })
})
