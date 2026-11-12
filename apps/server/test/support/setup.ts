import { afterAll, vi } from 'vitest'
import { dropTestDbs } from './db.js'

// The 1s default of vi.waitFor is too short when CI runs every file in parallel on a busy machine.
const waitFor = vi.waitFor
vi.waitFor = (cb, o) => waitFor(cb, typeof o === 'number' ? o : { timeout: 5_000, ...o })

afterAll(dropTestDbs)
