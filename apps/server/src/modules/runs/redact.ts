/** Replacement for anything that looks like a secret (spec §13, plan risk 6). */
export const MASK = '[已脱敏]'

const KEY = '[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api_?key)[A-Za-z0-9_]*'

const TOKENS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}/g,
  /\bglpat-[0-9A-Za-z_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
]
/** Credentials after a label that stays readable: auth headers, API key headers, long hex near a keyword. */
const LABELLED = [
  /\b(authorization\s*:\s*(?:(?:basic|bearer|token|digest)\s+)?)[^\s"']+/gi,
  /\b(bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b((?:x-)?api-key\s*:\s*|x-auth-token\s*:\s*|private-token\s*:\s*)[^\s"',;]+/gi,
  /((?:secret|token|key|passw(?:or)?d|auth)[^\n]{0,20}?)\b[0-9a-f]{40,}\b/gi,
]
/** `password=…`, `TOKEN="…"` and JSON `"api_key": "…"`. */
const ASSIGNMENT = new RegExp(String.raw`\b(${KEY}=)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'&;]+))`, 'gi')
const JSON_FIELD = new RegExp(String.raw`("${KEY}"\s*:\s*")[^"\n]*"`, 'gi')

export function redactor(values: string[]) {
  const known = values
    .map((v) => v.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  return (text: string) => {
    let out = text
    for (const v of known) out = out.split(v).join(MASK)
    for (const re of TOKENS) out = out.replace(re, MASK)
    for (const re of LABELLED) out = out.replace(re, `$1${MASK}`)
    return out
      .replace(ASSIGNMENT, (_m, key: string, dq?: string, sq?: string) =>
        dq !== undefined ? `${key}"${MASK}"` : sq !== undefined ? `${key}'${MASK}'` : `${key}${MASK}`,
      )
      .replace(JSON_FIELD, `$1${MASK}"`)
  }
}

/** Known secret values come from AIWS_REDACT_VALUES (comma list) until team secrets exist (P3). */
export const redact = redactor((process.env.AIWS_REDACT_VALUES ?? '').split(','))

/** Redacts every string inside a JSON value. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map(redactDeep) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T
  return value
}
