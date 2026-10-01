import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { expect, it } from 'vitest'
import { migrateDb } from '../src/db/client.js'
import { createTestDb } from './support/db.js'

const DRIZZLE = join(import.meta.dirname, '../drizzle')

/** The migrations before `tag`, as a folder of their own. */
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

it('moves existing data into one default team owned by the earliest sysadmin', async () => {
  const t = await createTestDb({ migrate: false })
  try {
    await migrate(t.db, { migrationsFolder: migrationsBefore('0033_teams') })
    await t.db.execute(sql`
      insert into users (id, account, name, password_hash, role, created_at, disabled_at) values
        ('00000000-0000-4000-8000-000000000001', 'm', 'M', 'x', 'member', '2026-01-01', null),
        ('00000000-0000-4000-8000-000000000002', 's1', 'S1', 'x', 'sysadmin', '2026-02-01', null),
        ('00000000-0000-4000-8000-000000000003', 's2', 'S2', 'x', 'sysadmin', '2026-03-01', null),
        ('00000000-0000-4000-8000-000000000004', 'off', 'Off', 'x', 'member', '2025-12-01', '2026-04-01');
      insert into groups (id, name, kind, created_by) values
        ('00000000-0000-4000-8000-0000000000a1', 'G', 'group', '00000000-0000-4000-8000-000000000001');
      insert into bots (name, owner_id, agent_kind, binding, created_by) values
        ('B', '00000000-0000-4000-8000-000000000001', 'claude', 'pending_bind', '00000000-0000-4000-8000-000000000001');
      insert into repos (key, url, name) values ('git.corp/a/b', 'git@git.corp:a/b.git', 'b');
      insert into notifications (user_id, type, payload) values ('00000000-0000-4000-8000-000000000001', 'chain_done', '{}');
      insert into audit_logs (category, action, group_id) values
        ('admin', 'group.update', '00000000-0000-4000-8000-0000000000a1'), ('admin', 'params.update', null);
      insert into mcp_servers (name, config) values ('wiki', '{}');
    `)
    await migrateDb(t.db)

    const teams = await t.db.execute<{ id: string; name: string; created_by: string }>(
      sql`select * from teams`,
    )
    expect(teams).toHaveLength(1)
    const team = teams[0]!
    expect(team).toMatchObject({ name: '默认团队', created_by: '00000000-0000-4000-8000-000000000002' })
    const members = await t.db.execute<{ user_id: string; role: string }>(
      sql`select user_id, role from team_members where team_id = ${team.id} order by user_id`,
    )
    expect(members.map((m) => [m.user_id.slice(-1), m.role])).toEqual([
      ['1', 'member'],
      ['2', 'owner'],
      ['3', 'member'],
      ['4', 'member'],
    ])
    for (const table of ['groups', 'bots', 'repos', 'notifications'])
      expect(await t.db.execute(sql`select team_id from ${sql.identifier(table)}`)).toEqual([
        { team_id: team.id },
      ])
    expect(
      (await t.db.execute<{ team_id: string | null }>(sql`select team_id from audit_logs order by id`)).map(
        (r) => r.team_id,
      ),
    ).toEqual([team.id, null])
    expect(await t.db.execute(sql`select scope, team_id, group_id from mcp_servers`)).toEqual([
      { scope: 'platform', team_id: null, group_id: null },
    ])
    const nullable = await t.db.execute<{ table_name: string; is_nullable: string }>(sql`
      select table_name, is_nullable from information_schema.columns
      where column_name = 'team_id' and table_name in ('groups', 'bots', 'repos') order by table_name`)
    expect(nullable.map((c) => c.is_nullable)).toEqual(['NO', 'NO', 'NO'])
  } finally {
    await t.close()
  }
})

it('creates no team on an empty database', async () => {
  const t = await createTestDb()
  try {
    expect(await t.db.execute(sql`select * from teams`)).toEqual([])
  } finally {
    await t.close()
  }
})
