import { z } from 'zod'
import { fail } from './errors.js'

const Uuid = z.uuid()

export const isUuid = (s: string) => Uuid.safeParse(s).success

/** Row ids are uuids; anything else cannot exist, so it is a 404 rather than a DB error. */
export const idParam = (s: string, what: string) => (isUuid(s) ? s : fail('not_found', `${what}不存在`))
