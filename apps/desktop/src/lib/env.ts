import { t } from '../i18n'

/** `KEY=VALUE` per line; throws on a line without `=`. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf('=')
    if (at <= 0) throw new Error(t('环境变量每行一个 KEY=VALUE：{line}', { line }))
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return env
}

export const formatEnv = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
