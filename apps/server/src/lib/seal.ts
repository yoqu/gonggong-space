import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createReadStream, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { open as openFd } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pipeline, Readable, Transform } from 'node:stream'

/** Encryption at rest (spec §13): AES-256-GCM under GONGGONG_DATA_KEY (32 bytes, base64). */
const ALG = 'aes-256-gcm'
const IV = 12
const TAG = 16
const ENVELOPE = /^v1:([A-Za-z0-9+/]{16}):([A-Za-z0-9+/]{22}==):([A-Za-z0-9+/=]*)$/
/** Sealed file layout: MAGIC | iv | ciphertext | tag. */
const MAGIC = Buffer.from('AIWSv1\n')
const HEAD = MAGIC.length + IV
export const FILE_OVERHEAD = HEAD + TAG

const DEV_KEY_FILE = resolve('.gonggong-dev/data.key')

let key: Buffer | undefined

function dataKey() {
  if (key) return key
  const k = Buffer.from((process.env.GONGGONG_DATA_KEY ?? devKey()).trim(), 'base64')
  if (k.length !== 32) throw new Error('GONGGONG_DATA_KEY must be 32 random bytes, base64-encoded')
  key = k
  return k
}

/** Dev only: one key per checkout, created atomically so concurrent processes agree on it. */
function devKey() {
  try {
    return readFileSync(DEV_KEY_FILE, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  mkdirSync(dirname(DEV_KEY_FILE), { recursive: true })
  const tmp = `${DEV_KEY_FILE}.${process.pid}`
  writeFileSync(tmp, randomBytes(32).toString('base64'), { mode: 0o600 })
  try {
    linkSync(tmp, DEV_KEY_FILE)
    console.warn(
      `[gonggong] GONGGONG_DATA_KEY is not set; generated a dev data key at ${DEV_KEY_FILE}. Set it in production.`,
    )
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  } finally {
    unlinkSync(tmp)
  }
  return readFileSync(DEV_KEY_FILE, 'utf8')
}

/** `v1:<iv>:<tag>:<ciphertext>`, each part base64. */
export function seal(plain: string) {
  const iv = randomBytes(IV)
  const c = createCipheriv(ALG, dataKey(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

/** Throws when the envelope was tampered with; values stored before encryption existed pass through. */
export function open(value: string) {
  const m = ENVELOPE.exec(value)
  if (!m) return value
  const [, iv, tag, ct] = m as unknown as [string, string, string, string]
  const d = createDecipheriv(ALG, dataKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

/** Encrypts a byte stream into the sealed file layout. */
export function sealStream() {
  const iv = randomBytes(IV)
  const c = createCipheriv(ALG, dataKey(), iv)
  let head = false
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!head) {
        this.push(Buffer.concat([MAGIC, iv]))
        head = true
      }
      done(null, c.update(chunk))
    },
    flush(done) {
      if (!head) this.push(Buffer.concat([MAGIC, iv]))
      this.push(c.final())
      done(null, c.getAuthTag())
    },
  })
}

/**
 * Plaintext stream of a sealed file. Tampering surfaces as a stream error at the end (GCM verifies the tag last),
 * which aborts the response. Files written before encryption existed are served as they are.
 */
export async function openFile(path: string): Promise<Readable> {
  const fd = await openFd(path)
  const head = Buffer.alloc(HEAD)
  const tag = Buffer.alloc(TAG)
  try {
    const { size } = await fd.stat()
    await fd.read(head, 0, HEAD, 0)
    if (size < FILE_OVERHEAD || !head.subarray(0, MAGIC.length).equals(MAGIC)) return createReadStream(path)
    await fd.read(tag, 0, TAG, size - TAG)
    const d = createDecipheriv(ALG, dataKey(), head.subarray(MAGIC.length))
    d.setAuthTag(tag)
    const body =
      size === FILE_OVERHEAD
        ? Readable.from([])
        : createReadStream(path, { start: HEAD, end: size - TAG - 1 })
    return pipeline(body, d, () => {})
  } finally {
    await fd.close()
  }
}
