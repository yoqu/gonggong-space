import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Db = ReturnType<typeof openDb>['db']

export function databaseUrl(dbName = process.env.GONGGONG_DB ?? 'gonggong') {
  return (
    process.env.GONGGONG_DATABASE_URL ??
    `postgres://gonggong@127.0.0.1:${process.env.GONGGONG_PG_PORT ?? 54329}/${dbName}`
  )
}

export function openDb(url = databaseUrl()) {
  const sql = postgres(url, { onnotice: () => {} })
  return { sql, db: drizzle(sql, { schema }) }
}

export async function migrateDb(db: Db) {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, '../../drizzle') })
}
