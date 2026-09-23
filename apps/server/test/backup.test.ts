import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseUrl } from '../src/db/client.js'

const scripts = join(import.meta.dirname, '../../../scripts')
const admin = postgres(databaseUrl('postgres'), { onnotice: () => {} })
const source = `aiws_bk_${randomBytes(4).toString('hex')}`
const target = `${source}_restored`
const work = mkdtempSync(join(tmpdir(), 'aiws-backup-'))
const backups = join(work, 'backups')
const env = (db: string, dataDir: string) => ({
  ...process.env,
  AIWS_DATABASE_URL: databaseUrl(db),
  AIWS_BACKUP_DIR: backups,
  AIWS_DATA_DIR: dataDir,
})

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${source}`)
  await admin.unsafe(`CREATE DATABASE ${target}`)
  const db = postgres(databaseUrl(source), { onnotice: () => {} })
  await db.unsafe(
    `CREATE TABLE notes (id int primary key, body text); INSERT INTO notes VALUES (1, '备份我')`,
  )
  await db.end()
})
afterAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${source} WITH (FORCE)`)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`)
  await admin.end()
})

describe('scripts/backup.sh + restore.sh', () => {
  it('backs up the database and attachments, keeps the newest 7, and restores them into another place', async () => {
    const data = join(work, 'data')
    mkdirSync(join(data, 'attachments/ab'), { recursive: true })
    writeFileSync(join(data, 'attachments/ab/file.txt'), 'attachment')
    mkdirSync(backups)
    for (let d = 1; d <= 8; d++) {
      const stamp = `2026010${d}-000000`
      writeFileSync(join(backups, `aiws-${stamp}.dump`), '')
      writeFileSync(join(backups, `attachments-${stamp}.tar.gz`), '')
    }

    const out = execFileSync('bash', [join(scripts, 'backup.sh')], {
      env: env(source, data),
      encoding: 'utf8',
    })
    const stamp = /aiws-(\d{8}-\d{6})\.dump/.exec(out)?.[1]
    expect(stamp).toBeTruthy()
    const files = readdirSync(backups).sort()
    expect(files.filter((f) => f.endsWith('.dump'))).toHaveLength(7)
    expect(files.filter((f) => f.endsWith('.tar.gz'))).toHaveLength(7)
    expect(files).toContain(`aiws-${stamp}.dump`)
    expect(files).not.toContain('aiws-20260101-000000.dump')

    const restored = join(work, 'restored')
    execFileSync('bash', [join(scripts, 'restore.sh'), stamp!], { env: env(target, restored), stdio: 'pipe' })
    const db = postgres(databaseUrl(target), { onnotice: () => {} })
    expect(await db.unsafe('SELECT body FROM notes')).toEqual([{ body: '备份我' }])
    await db.end()
    expect(readFileSync(join(restored, 'attachments/ab/file.txt'), 'utf8')).toBe('attachment')
  })
})
