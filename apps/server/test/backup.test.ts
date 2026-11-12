import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseUrl } from '../src/db/client.js'

const scripts = join(import.meta.dirname, '../../../scripts')
const admin = postgres(databaseUrl('postgres'), { onnotice: () => {} })
const source = `gonggong_bk_${randomBytes(4).toString('hex')}`
const target = `${source}_restored`
const work = mkdtempSync(join(tmpdir(), 'gonggong-backup-'))
const backups = join(work, 'backups')
const env = (db: string, dataDir: string) => ({
  ...process.env,
  GONGGONG_DATABASE_URL: databaseUrl(db),
  GONGGONG_BACKUP_DIR: backups,
  GONGGONG_DATA_DIR: dataDir,
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
  it('backs up the database and attachments, keeps the newest 7 plus the newest of each of the last 7 days, and restores them into another place', async () => {
    const data = join(work, 'data')
    mkdirSync(join(data, 'attachments/ab'), { recursive: true })
    writeFileSync(join(data, 'attachments/ab/file.txt'), 'attachment')
    mkdirSync(backups)
    for (let d = 1; d <= 8; d++) {
      for (const time of ['000000', '120000']) {
        const stamp = `2026010${d}-${time}`
        writeFileSync(join(backups, `gonggong-${stamp}.dump`), '')
        writeFileSync(join(backups, `attachments-${stamp}.tar.gz`), '')
      }
    }
    writeFileSync(join(backups, 'attachments-20260105-130000.tar.gz'), '')
    writeFileSync(join(backups, 'gonggong-manual.dump'), '')

    const out = execFileSync('bash', [join(scripts, 'backup.sh')], {
      env: env(source, data),
      encoding: 'utf8',
    })
    const stamp = /gonggong-(\d{8}-\d{6})\.dump/.exec(out)?.[1]
    expect(stamp).toBeTruthy()
    const files = readdirSync(backups).sort()
    // Newest of days 3–5, every backup of days 6–8 (the newest 7 with this run), and this run.
    const kept = ['03-12', '04-12', '05-12', '06-00', '06-12', '07-00', '07-12', '08-00', '08-12']
      .map((s) => `202601${s}0000`)
      .concat(stamp!)
    expect(files.filter((f) => f.endsWith('.dump'))).toEqual(
      kept.map((s) => `gonggong-${s}.dump`).concat('gonggong-manual.dump'),
    )
    expect(files.filter((f) => f.endsWith('.tar.gz'))).toEqual(kept.map((s) => `attachments-${s}.tar.gz`))

    const restored = join(work, 'restored')
    execFileSync('bash', [join(scripts, 'restore.sh'), stamp!], { env: env(target, restored), stdio: 'pipe' })
    const db = postgres(databaseUrl(target), { onnotice: () => {} })
    expect(await db.unsafe('SELECT body FROM notes')).toEqual([{ body: '备份我' }])
    await db.end()
    expect(readFileSync(join(restored, 'attachments/ab/file.txt'), 'utf8')).toBe('attachment')
  })
  it('tolerates attachments changing while tar reads them (tar exit 1), but not real tar errors', () => {
    const data = join(work, 'data-live')
    mkdirSync(join(data, 'attachments'), { recursive: true })
    writeFileSync(join(data, 'attachments/file.txt'), 'attachment')
    const dir = join(work, 'live-backups')
    const realTar = execFileSync('bash', ['-c', 'command -v tar'], { encoding: 'utf8' }).trim()
    const run = (code: number) => {
      const bin = join(work, `tar-exit-${code}`)
      mkdirSync(bin)
      writeFileSync(
        join(bin, 'tar'),
        `#!/usr/bin/env bash\n"${realTar}" "$@"\necho 'tar: attachments: file changed as we read it' >&2\nexit ${code}\n`,
      )
      chmodSync(join(bin, 'tar'), 0o755)
      return () =>
        execFileSync('bash', [join(scripts, 'backup.sh')], {
          env: { ...env(source, data), GONGGONG_BACKUP_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
          stdio: 'pipe',
        })
    }
    run(1)()
    expect(readdirSync(dir).some((f) => /^attachments-.*\.tar\.gz$/.test(f))).toBe(true)
    expect(run(2)).toThrow()
  })
})
