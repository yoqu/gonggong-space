import { t } from '../i18n'

/** `KEY=VALUE` per line; throws on a line without `=` or, as half-typed, without a value. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf('=')
    if (at <= 0) throw new Error(t('环境变量每行一个 KEY=VALUE：{line}', { line }))
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (!value) throw new Error(t('{key} 的值为空', { key }))
    env[key] = value
  }
  return env
}

export const formatEnv = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
