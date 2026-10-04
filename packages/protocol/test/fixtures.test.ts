import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DaemonBotDto,
  DaemonToServer,
  ServerToDaemon,
  SyncChangesRes,
  SyncMissingRes,
  TunnelHead,
  TunnelOpen,
  TunnelReset,
} from '../src/index.js'

const dir = join(import.meta.dirname, '../fixtures')
const schemas = { d2s: DaemonToServer, s2d: ServerToDaemon }
const tunnel = { open: TunnelOpen, head: TunnelHead, reset: TunnelReset }
/** Machine-token REST bodies the daemon parses. */
const http = {
  'daemon-bots': z.array(DaemonBotDto),
  'sync-changes': SyncChangesRes,
  'sync-missing': SyncMissingRes,
}

describe('wire fixtures (shared with the Rust daemon)', () => {
  for (const file of readdirSync(dir)) {
    it(file, () => {
      const [dirn, kind, ...rest] = file.split('.')
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (dirn === 'tunnel' || dirn === 'http') {
        const schema =
          dirn === 'tunnel' ? tunnel[kind as keyof typeof tunnel] : http[kind as keyof typeof http]
        expect(schema.parse(raw)).toEqual(raw)
        return
      }
      const msg = schemas[dirn as keyof typeof schemas].parse(raw)
      expect([kind, ...rest].join('.').startsWith(msg.t)).toBe(true)
    })
  }
})
