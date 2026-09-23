import { readFileSync } from 'node:fs'

export type TlsOptions = { cert: Buffer; key: Buffer }

/** Spec §13: with a certificate configured the server speaks only HTTPS/WSS; without, plain HTTP for loopback dev. */
export function tlsOptions(env: NodeJS.ProcessEnv = process.env): TlsOptions | null {
  const { AIWS_TLS_CERT: cert, AIWS_TLS_KEY: key } = env
  if (!cert && !key) return null
  if (!cert || !key) throw new Error('AIWS_TLS_CERT and AIWS_TLS_KEY must be set together')
  return { cert: readFileSync(cert), key: readFileSync(key) }
}
