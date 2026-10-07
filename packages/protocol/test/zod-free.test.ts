import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The desktop app imports only these at runtime; with `sideEffects: false` they keep zod out of its bundle.
describe('zod-free modules', () => {
  it.each(['translate.ts', 'version.ts', 'tool-titles.ts', 'i18n-en.ts'])('%s imports nothing', (file) => {
    expect(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).not.toMatch(/^import /m)
  })
})
