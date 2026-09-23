import { expect, it } from 'vitest'
import { users } from '../src/db/schema.js'
import { createTestDb } from './support/db.js'

it('migrates a fresh database and round-trips a row', async () => {
  const t = await createTestDb()
  try {
    const [u] = await t.db.insert(users).values({ account: 'a', name: 'A', passwordHash: 'x' }).returning()
    expect(u?.role).toBe('member')
    expect(u?.mustChangePassword).toBe(true)
  } finally {
    await t.close()
  }
})
