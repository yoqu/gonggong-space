import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AGENT_SETTING_FIELDS,
  DaemonBotDto,
  DaemonPluginRes,
  DaemonSkillRes,
  DaemonToServer,
  ServerToDaemon,
  SyncChangesRes,
  SyncMissingRes,
  TerminalClientControl,
  TerminalDaemonControl,
  TerminalHead,
  TunnelHead,
  TunnelOpen,
  TunnelReset,
} from '../src/index.js'

const dir = join(import.meta.dirname, '../fixtures')
const schemas = { d2s: DaemonToServer, s2d: ServerToDaemon }
const tunnel = { open: TunnelOpen, head: TunnelHead, reset: TunnelReset }
const terminal = {
  head: TerminalHead,
  'client-control': TerminalClientControl,
  'daemon-control': TerminalDaemonControl,
}
/** Machine-token REST bodies the daemon parses. */
const http = {
  'daemon-bots': z.array(DaemonBotDto),
  'daemon-skill': DaemonSkillRes,
  'daemon-plugin': DaemonPluginRes,
  'sync-changes': SyncChangesRes,
  'sync-missing': SyncMissingRes,
}

describe('wire fixtures (shared with the Rust daemon)', () => {
  for (const file of readdirSync(dir)) {
    it(file, () => {
      const [dirn, kind, ...rest] = file.split('.')
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (dirn === 'data') {
        expect(raw).toEqual(JSON.parse(JSON.stringify(AGENT_SETTING_FIELDS)))
        return
      }
      if (dirn === 'tunnel' || dirn === 'http' || dirn === 'terminal') {
        const schema =
          dirn === 'tunnel'
            ? tunnel[kind as keyof typeof tunnel]
            : dirn === 'terminal'
              ? terminal[kind as keyof typeof terminal]
              : http[kind as keyof typeof http]
        expect(schema.parse(raw)).toEqual(raw)
        return
      }
      const msg = schemas[dirn as keyof typeof schemas].parse(raw)
      expect([kind, ...rest].join('.').startsWith(msg.t)).toBe(true)
    })
  }
})
