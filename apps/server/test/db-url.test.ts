import { afterEach, expect, it, vi } from 'vitest'
import { databaseUrl } from '../src/db/client.js'

afterEach(() => vi.unstubAllEnvs())

it('swaps only the database name of a configured URL', () => {
  vi.stubEnv('GONGGONG_DATABASE_URL', 'postgres://u:p%40ss@db.example:6543/prod?sslmode=require')
  expect(databaseUrl('gonggong_t_1')).toBe('postgres://u:p%40ss@db.example:6543/gonggong_t_1?sslmode=require')
})

it('returns a configured URL unchanged without a name', () => {
  vi.stubEnv('GONGGONG_DATABASE_URL', 'postgres://u:p@db.example:6543/prod?sslmode=require')
  vi.stubEnv('GONGGONG_DB', 'other')
  expect(databaseUrl()).toBe('postgres://u:p@db.example:6543/prod?sslmode=require')
})

it('falls back to the local database', () => {
  vi.stubEnv('GONGGONG_DATABASE_URL', undefined)
  vi.stubEnv('GONGGONG_DB', undefined)
  vi.stubEnv('GONGGONG_PG_PORT', undefined)
  expect(databaseUrl()).toBe('postgres://gonggong@127.0.0.1:54329/gonggong')
  expect(databaseUrl('x')).toBe('postgres://gonggong@127.0.0.1:54329/x')
})
