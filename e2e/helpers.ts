import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const ROOT = join(import.meta.dirname, '..')
export const SERVER = 'http://127.0.0.1:8790'
export const AIWS_BIN = join(ROOT, 'target/debug/aiws')

export function buildDaemon() {
  execFileSync('cargo', ['build', '-q', '-p', 'aiws'], { cwd: ROOT, stdio: 'inherit' })
}

export function aiws(args: string[], env: Record<string, string> = {}) {
  return execFileSync(AIWS_BIN, args, { encoding: 'utf8', env: { ...process.env, ...env } })
}
