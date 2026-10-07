import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Db = ReturnType<typeof openDb>['db']

export function databaseUrl(dbName?: string) {
  const configured = process.env.GONGGONG_DATABASE_URL
  if (configured) {
    if (!dbName) return configured
    const url = new URL(configured)
    url.pathname = `/${dbName}`
    return url.toString()
  }
  return `postgres://gonggong@127.0.0.1:${process.env.GONGGONG_PG_PORT ?? 54329}/${dbName ?? process.env.GONGGONG_DB ?? 'gonggong'}`
}

export function openDb(url = databaseUrl()) {
  const sql = postgres(url, { onnotice: () => {} })
  return { sql, db: drizzle(sql, { schema }) }
}

export async function migrateDb(db: Db) {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, '../../drizzle') })
}
