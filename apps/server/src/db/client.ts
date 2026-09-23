import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Db = ReturnType<typeof openDb>['db']

export function databaseUrl(dbName = process.env.AIWS_DB ?? 'aiws') {
  return (
    process.env.AIWS_DATABASE_URL ??
    `postgres://aiws@127.0.0.1:${process.env.AIWS_PG_PORT ?? 54329}/${dbName}`
  )
}

export function openDb(url = databaseUrl()) {
  const sql = postgres(url, { onnotice: () => {} })
  return { sql, db: drizzle(sql, { schema }) }
}

export async function migrateDb(db: Db) {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, '../../drizzle') })
}
