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

const ids = { u: '1', t: 'f', a: 'a', b: 'b', c: 'c', p1: 'e1', p2: 'e2', v11: 'd11', v12: 'd12', v21: 'd21' }
const id = (k: keyof typeof ids) => `00000000-0000-4000-8000-${ids[k].padStart(12, '0')}`
const q = (k: keyof typeof ids) => `'${id(k)}'`

it('turns group plugin switches into group installs, keeping each group on or off as it was', async () => {
  const t = await createTestDb({ migrate: false })
  try {
    await migrate(t.db, { migrationsFolder: migrationsBefore('0091_market_installs') })
    await t.db.execute(
      sql.raw(`
      insert into users (id, account, name, password_hash, role) values (${q('u')}, 'u', 'U', 'x', 'sysadmin');
      insert into teams (id, name, created_by) values (${q('t')}, 'T', ${q('u')});
      insert into groups (id, team_id, name, kind, created_by) values
        (${q('a')}, ${q('t')}, 'A', 'group', ${q('u')}),
        (${q('b')}, ${q('t')}, 'B', 'group', ${q('u')}),
        (${q('c')}, ${q('t')}, 'C', 'group', ${q('u')});
      insert into plugins (id, scope, name, version_id) values
        (${q('p1')}, 'platform', 'deck', ${q('v12')}),
        (${q('p2')}, 'team', 'poster', ${q('v21')});
      update plugins set team_id = ${q('t')} where id = ${q('p2')};
      insert into plugin_versions (id, plugin_id, revision, files, manifest, digest, size) values
        (${q('v11')}, ${q('p1')}, 1, '[]', '{}', 'd', 0),
        (${q('v12')}, ${q('p1')}, 2, '[]', '{}', 'd', 0),
        (${q('v21')}, ${q('p2')}, 1, '[]', '{}', 'd', 0);
      insert into group_plugins (group_id, plugin_id, enabled, updated_by, updated_at) values
        (${q('a')}, ${q('p1')}, true, ${q('u')}, '2026-10-01T00:00:00Z'),
        (${q('a')}, ${q('p2')}, false, null, '2026-10-02T00:00:00Z'),
        (${q('b')}, ${q('p2')}, true, null, '2026-10-03T00:00:00Z');
    `),
    )
    await migrateDb(t.db)

    const rows = await t.db.execute<Record<string, unknown>>(sql`
      select listing_id, scope, scope_id, pin_version_id, resolved_version_id, enabled, updated_by, updated_at
      from installs order by scope_id, listing_id`)
    expect(rows.map((r) => ({ ...r, updated_at: new Date(r.updated_at as string).toISOString() }))).toEqual([
      {
        listing_id: id('p1'),
        scope: 'group',
        scope_id: id('a'),
        pin_version_id: null,
        resolved_version_id: id('v12'),
        enabled: true,
        updated_by: id('u'),
        updated_at: '2026-10-01T00:00:00.000Z',
      },
      expect.objectContaining({ listing_id: id('p2'), scope_id: id('a'), enabled: false }),
      expect.objectContaining({ listing_id: id('p2'), scope_id: id('b'), enabled: true }),
    ])
    expect(await t.db.execute(sql`select type, status from plugins order by name`)).toEqual([
      { type: 'plugin', status: 'listed' },
      { type: 'plugin', status: 'listed' },
    ])
    expect(await t.db.execute(sql`select to_regclass('group_plugins') as t`)).toEqual([{ t: null }])
  } finally {
    await t.close()
  }
})
