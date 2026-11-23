import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { expect, it } from 'vitest'
import { migrateDb } from '../src/db/client.js'
import { createTestDb } from './support/db.js'

const DRIZZLE = join(import.meta.dirname, '../drizzle')

function migrationsBefore(tag: string) {
  const dir = mkdtempSync(join(tmpdir(), 'gg-migrations-'))
  cpSync(DRIZZLE, dir, { recursive: true })
  const journal = JSON.parse(readFileSync(join(DRIZZLE, 'meta/_journal.json'), 'utf8'))
  const entries = journal.entries.slice(
    0,
    journal.entries.findIndex((e: { tag: string }) => e.tag === tag),
  )
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  return dir
}

const ids = {
  u: '1',
  w: '2',
  t: 'f',
  g: 'a',
  proto: 'b1',
  site: 'b2',
  v1: 'c1',
  v2: 'c2',
  sv: 'c3',
  m: 'd1',
  open: 'e1',
  sent: 'e2',
  done: 'e3',
}
const id = (k: keyof typeof ids) => `00000000-0000-4000-8000-${ids[k].padStart(12, '0')}`
const q = (k: keyof typeof ids) => `'${id(k)}'`

it('backfills artifact kinds and moves every annotation into a thread with its note as the first message', async () => {
  const t = await createTestDb({ migrate: false })
  try {
    await migrate(t.db, { migrationsFolder: migrationsBefore('0120_artifact_threads') })
    await t.db.execute(
      sql.raw(`
      insert into users (id, account, name, password_hash, role) values
        (${q('u')}, 'u', '李建国', 'x', 'member'), (${q('w')}, 'w', '王磊', 'x', 'member');
      insert into teams (id, name, created_by) values (${q('t')}, 'T', ${q('u')});
      insert into groups (id, team_id, name, kind, created_by) values (${q('g')}, ${q('t')}, 'G', 'group', ${q('u')});
      insert into artifacts (id, group_id, title, dir, site_dir) values
        (${q('proto')}, ${q('g')}, '原型', 'design/app-1', null),
        (${q('site')}, ${q('g')}, '网页', 'design/site-1', 'dist');
      insert into artifact_versions (id, artifact_id, n, source, files, digest) values
        (${q('v1')}, ${q('proto')}, 1, 'run', '[]', 'd'),
        (${q('v2')}, ${q('proto')}, 2, 'edit', '[]', 'd'),
        (${q('sv')}, ${q('site')}, 1, 'host', '[]', 'd');
      insert into messages (id, group_id, kind, author_user_id, body) values
        (${q('m')}, ${q('g')}, 'user', ${q('u')}, '@bot 按 1 条批注修改');
      insert into artifact_annotations
        (id, artifact_id, version_id, file, gg_id, selector, rect, snippet, note, author_id, status, sent_message_id, created_at)
      values
        (${q('open')}, ${q('proto')}, ${q('v2')}, 'screens/home.html', '12', 'section > h1',
          '{"x":1,"y":2,"w":3,"h":4}', '<h1>报名</h1>', '字大一点', ${q('u')}, 'open', null, '2026-11-01T00:00:00Z'),
        (${q('sent')}, ${q('proto')}, ${q('v1')}, 'screens/home.html', null, '',
          '{"x":0,"y":500,"w":10,"h":10}', '3, 7', '这里加个按钮', ${q('w')}, 'sent', ${q('m')}, '2026-11-02T00:00:00Z'),
        (${q('done')}, ${q('proto')}, ${q('v1')}, 'index.html', null, 'div.x',
          '{"x":0,"y":0,"w":1,"h":1}', '', '浮层去掉', ${q('u')}, 'resolved', ${q('m')}, '2026-11-03T00:00:00Z');
    `),
    )
    await migrateDb(t.db)

    expect(await t.db.execute(sql`select id, kind, editor_version from artifacts order by dir`)).toEqual([
      { id: id('proto'), kind: 'prototype', editor_version: null },
      { id: id('site'), kind: 'site', editor_version: null },
    ])
    const threads = await t.db.execute<Record<string, unknown>>(sql`
      select id, artifact_id, version_id, anchor, label, detail, location, status, resolved_by, sent_message_id, created_by, created_at
      from artifact_threads order by created_at`)
    expect(
      threads.map((r) => ({ ...r, created_at: new Date(r.created_at as string).toISOString() })),
    ).toEqual([
      {
        id: id('open'),
        artifact_id: id('proto'),
        version_id: id('v2'),
        anchor: {
          kind: 'prototype',
          file: 'screens/home.html',
          ggId: '12',
          selector: 'section > h1',
          rect: { x: 1, y: 2, w: 3, h: 4 },
          snippet: '<h1>报名</h1>',
        },
        label: 'section > h1',
        detail: null,
        location: {},
        status: 'open',
        resolved_by: null,
        sent_message_id: null,
        created_by: id('u'),
        created_at: '2026-11-01T00:00:00.000Z',
      },
      {
        id: id('sent'),
        artifact_id: id('proto'),
        version_id: id('v1'),
        anchor: {
          kind: 'prototype',
          file: 'screens/home.html',
          ggId: null,
          selector: '',
          rect: { x: 0, y: 500, w: 10, h: 10 },
          snippet: '3, 7',
        },
        label: 'screens/home.html',
        detail: null,
        location: {},
        status: 'sent',
        resolved_by: null,
        sent_message_id: id('m'),
        created_by: id('w'),
        created_at: '2026-11-02T00:00:00.000Z',
      },
      expect.objectContaining({
        id: id('done'),
        label: 'div.x',
        detail: null,
        location: {},
        status: 'resolved',
        resolved_by: null,
        sent_message_id: id('m'),
      }),
    ])
    const msgs = await t.db.execute<Record<string, unknown>>(sql`
      select thread_id, author_kind, author_id, text, "to", reactions, at, edited_at
      from artifact_thread_messages order by at`)
    expect(msgs.map((r) => ({ ...r, at: new Date(r.at as string).toISOString() }))).toEqual([
      {
        thread_id: id('open'),
        author_kind: 'user',
        author_id: id('u'),
        text: '字大一点',
        to: [],
        reactions: [],
        at: '2026-11-01T00:00:00.000Z',
        edited_at: null,
      },
      expect.objectContaining({ thread_id: id('sent'), author_id: id('w'), text: '这里加个按钮' }),
      expect.objectContaining({ thread_id: id('done'), author_id: id('u'), text: '浮层去掉' }),
    ])
    // Kept one release for rollback.
    expect(await t.db.execute(sql`select count(*)::int as n from artifact_annotations`)).toEqual([{ n: 3 }])
  } finally {
    await t.close()
  }
}, 60_000)
