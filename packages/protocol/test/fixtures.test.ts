import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DaemonToServer, ServerToDaemon } from '../src/index.js'

const dir = join(import.meta.dirname, '../fixtures')
const schemas = { d2s: DaemonToServer, s2d: ServerToDaemon }

describe('wire fixtures (shared with the Rust daemon)', () => {
  for (const file of readdirSync(dir)) {
    it(file, () => {
      const [dirn, t] = file.split('.') as [keyof typeof schemas, string]
      const msg = schemas[dirn].parse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
      expect(msg.t).toBe(t)
    })
  }
})
