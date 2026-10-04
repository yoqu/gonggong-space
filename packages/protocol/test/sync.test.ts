import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DaemonToServer,
  RunDone,
  RunStart,
  ServerToDaemon,
  SYNC_SUBMIT_CHANGES_MAX,
  SyncChange,
  type SyncEntry,
  SyncPath,
  SyncSubmit,
  syncRootText,
  WebEvent,
} from '../src/index.js'

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures', name), 'utf8'))
const cases: { name: string; entries: SyncEntry[]; hash: string }[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '../cases/sync-root.json'), 'utf8'),
)
const H = 'a'.repeat(64)

describe('sync paths', () => {
  it('accepts posix paths relative to the workspace root', () => {
    for (const p of [
      'a.txt',
      'src/main.rs',
      '.github/ci.yml',
      'docs/中文.md',
      'a..b/c',
      'console.txt',
      'com10',
      'lpt0.txt',
      'a/.gonggong/x',
      '.gitignore',
      'git~x',
      '.git2',
    ])
      expect(SyncPath.safeParse(p).success, p).toBe(true)
  })

  it('rejects anything that could leave the root or is not canonical', () => {
    for (const p of [
      '',
      '/etc/passwd',
      '../x',
      'a/../b',
      'a/./b',
      'a//b',
      'a/',
      'a\\b',
      '.',
      'a\0b',
      '.git/config',
    ])
      expect(SyncPath.safeParse(p).success, JSON.stringify(p)).toBe(false)
  })

  it('rejects names some platform cannot hold or that alias .git / the daemon state (F4, F17)', () => {
    for (const p of [
      'c:x',
      'a/b:stream',
      'a\tb',
      'a\x1fb',
      'a\x7fb',
      'a/b.',
      'a/b ',
      'dir./x',
      'CON',
      'con.txt',
      'src/Aux.c',
      'NUL.tar.gz',
      'com1',
      'COM9.log',
      'lpt5.txt',
      'prn .txt',
      '.GIT/config',
      'x/.Git',
      '.git.',
      '.git ',
      '.git../x',
      'GIT~1/config',
      'a/git~12',
      '.g\u200cit/config',
      '.gonggong/state.json',
      '.GongGong',
    ])
      expect(SyncPath.safeParse(p).success, JSON.stringify(p)).toBe(false)
  })
})

describe('sync submit', () => {
  it('caps the changes per submit', () => {
    const change = { path: 'a', hash: H, exec: false, baseHash: null }
    const msg = (n: number) => ({
      t: 'sync.submit',
      groupId: 'g',
      botId: 'b',
      submitId: '00000000-0000-4000-8000-000000000000',
      runId: null,
      baseVersion: 0,
      kind: 'run',
      merged: false,
      changes: Array.from({ length: n }, () => change),
    })
    expect(SyncSubmit.safeParse(msg(SYNC_SUBMIT_CHANGES_MAX)).success).toBe(true)
    expect(SyncSubmit.safeParse(msg(SYNC_SUBMIT_CHANGES_MAX + 1)).success).toBe(false)
  })
})

describe('sync changes', () => {
  it('hash is a lowercase sha256 hex, null meaning deleted / absent', () => {
    expect(SyncChange.safeParse({ path: 'a', hash: H, exec: false, baseHash: null }).success).toBe(true)
    expect(SyncChange.safeParse({ path: 'a', hash: null, exec: false, baseHash: H }).success).toBe(true)
    expect(
      SyncChange.safeParse({ path: 'a', hash: H.toUpperCase(), exec: false, baseHash: null }).success,
    ).toBe(false)
    expect(SyncChange.safeParse({ path: 'a', hash: 'abc', exec: false, baseHash: null }).success).toBe(false)
  })
})

describe('run sync fields', () => {
  it('older run.start / run.done without sync parse as null', () => {
    expect(RunStart.parse(fixture('s2d.run.start.json')).sync).toBeNull()
    expect(RunDone.parse(fixture('d2s.run.done.json')).sync).toBeNull()
  })

  it('force groups carry the catch-up hint and the submit result', () => {
    expect(RunStart.parse(fixture('s2d.run.start.sync.json')).sync).toEqual({
      headVersion: 17,
      lastVersion: 12,
      changed: ['server/pay.go', 'web/src/api.ts'],
      changedTotal: 2,
      resolve: [
        { path: 'server/pay.go', choice: 'bot' },
        { path: 'web/src/api.ts', choice: 'mine' },
      ],
    })
    expect(RunDone.parse(fixture('d2s.run.done.sync.json')).sync).toEqual({
      outcome: 'accepted',
      version: 18,
      merged: true,
    })
    expect(RunDone.parse(fixture('d2s.run.done.sync.waiting.json')).sync).toEqual({
      outcome: 'waiting',
      issue: 'drift',
    })
  })
})

describe('sync messages', () => {
  it('every direction parses its own and rejects the other', () => {
    expect(DaemonToServer.safeParse(fixture('d2s.sync.submit.json')).success).toBe(true)
    expect(ServerToDaemon.safeParse(fixture('d2s.sync.submit.json')).success).toBe(false)
    expect(ServerToDaemon.safeParse(fixture('s2d.sync.result.conflict.json')).success).toBe(true)
    expect(DaemonToServer.safeParse(fixture('s2d.sync.result.conflict.json')).success).toBe(false)
  })

  it('a submit id is a uuid so retries are idempotent', () => {
    const msg = fixture('d2s.sync.submit.json')
    expect(DaemonToServer.safeParse({ ...msg, submitId: 'x' }).success).toBe(false)
  })

  it('the web gets the group sync status live', () => {
    const ev = {
      t: 'group.sync',
      groupId: 'g1',
      headVersion: 3,
      consistent: 0,
      total: 0,
      switching: false,
      replicas: [],
    }
    expect(WebEvent.parse(ev)).toEqual(ev)
  })
})

describe('syncRootText (vectors shared with the Rust daemon)', () => {
  for (const c of cases)
    it(c.name, () => {
      expect(createHash('sha256').update(syncRootText(c.entries)).digest('hex')).toBe(c.hash)
    })

  it('sorts by UTF-8 bytes, skips deleted entries and marks exec', () => {
    const e = (path: string, hash: string | null, exec = false) => ({ path, hash, exec })
    expect(syncRootText([e('b', H), e('a', null), e('\u{1F600}', H), e('～', H, true)])).toBe(
      `b\0-\0${H}\n～\0x\0${H}\n\u{1F600}\0-\0${H}\n`,
    )
  })
})
