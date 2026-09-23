import { createHash, randomBytes } from 'node:crypto'

export const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
