import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'
import { databaseUrl, migrateDb, openDb } from '../../src/db/client.js'

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string
  }
}

/** Migrates one template per run; `createTestDb` clones it instead of replaying every migration per test. */
export default async function setup(project: TestProject) {
  const name = `gonggong_tpl_${randomBytes(4).toString('hex')}`
  const admin = postgres(databaseUrl('postgres'), { onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE ${name}`)
  const { db, sql } = openDb(databaseUrl(name))
  await migrateDb(db)
  // CREATE DATABASE … TEMPLATE refuses while any session is connected to the template.
  await sql.end()
  project.provide('templateDb', name)
  return async () => {
    await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`)
    await admin.end()
  }
}
