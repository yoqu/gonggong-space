import { readFileSync } from 'node:fs'

export type TlsOptions = { cert: Buffer; key: Buffer }

/** Spec §13: with a certificate configured the server speaks only HTTPS/WSS; without, plain HTTP for loopback dev. */
export function tlsOptions(env: NodeJS.ProcessEnv = process.env): TlsOptions | null {
  const { GONGGONG_TLS_CERT: cert, GONGGONG_TLS_KEY: key } = env
  if (!cert && !key) return null
  if (!cert || !key) throw new Error('GONGGONG_TLS_CERT and GONGGONG_TLS_KEY must be set together')
  return { cert: readFileSync(cert), key: readFileSync(key) }
}
