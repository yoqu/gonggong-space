import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { inject } from 'vitest'
import { databaseUrl, openDb } from '../../src/db/client.js'

/** A fresh, fully migrated (cloned from the run's template, unless told otherwise) database per test; dropped by `close()`. */
export async function createTestDb({ migrate = true } = {}) {
  const name = `gonggong_t_${randomBytes(4).toString('hex')}`
  const admin = postgres(databaseUrl('postgres'), { onnotice: () => {} })
  await admin.unsafe(
    migrate ? `CREATE DATABASE ${name} TEMPLATE ${inject('templateDb')}` : `CREATE DATABASE ${name}`,
  )
  const { db, sql } = openDb(databaseUrl(name))
  return {
    db,
    close: async () => {
      await sql.end()
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`)
      await admin.end()
    },
  }
}
