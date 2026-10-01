import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { databaseUrl, migrateDb, openDb } from '../../src/db/client.js'

/** A fresh, fully migrated (unless told otherwise) database per test file; dropped by `close()`. */
export async function createTestDb({ migrate = true } = {}) {
  const name = `gonggong_t_${randomBytes(4).toString('hex')}`
  const admin = postgres(databaseUrl('postgres'), { onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE ${name}`)
  const { db, sql } = openDb(databaseUrl(name))
  if (migrate) await migrateDb(db)
  return {
    db,
    close: async () => {
      await sql.end()
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`)
      await admin.end()
    },
  }
}
