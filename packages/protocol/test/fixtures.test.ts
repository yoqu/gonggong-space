import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DaemonToServer, ServerToDaemon, TunnelHead, TunnelOpen, TunnelReset } from '../src/index.js'

const dir = join(import.meta.dirname, '../fixtures')
const schemas = { d2s: DaemonToServer, s2d: ServerToDaemon }
const tunnel = { open: TunnelOpen, head: TunnelHead, reset: TunnelReset }

describe('wire fixtures (shared with the Rust daemon)', () => {
  for (const file of readdirSync(dir)) {
    it(file, () => {
      const [dirn, kind, ...rest] = file.split('.')
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (dirn === 'tunnel') {
        expect(tunnel[kind as keyof typeof tunnel].parse(raw)).toEqual(raw)
        return
      }
      const msg = schemas[dirn as keyof typeof schemas].parse(raw)
      expect([kind, ...rest].join('.').startsWith(msg.t)).toBe(true)
    })
  }
})
