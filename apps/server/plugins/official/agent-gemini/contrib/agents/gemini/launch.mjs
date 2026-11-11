// Gonggong launch script for Gemini CLI (plan 插件扩展点 §5.2). Gemini's ACP mode takes no per-session instructions,
// so each (group, bot) runs with a GEMINI_CLI_HOME of its own (`state`): the user's settings with the login the run's
// provider needs and the built-in gonggong server, the bot's instructions as the global GEMINI.md before the user's
// own, and links to the user's logins, extensions and skills. Its sessions are stored there too, so a later process
// of the same (group, bot) resumes them.
import fs from 'node:fs'
import path from 'node:path'

/** What the user's ~/.gemini shares with every bot: logins, MCP OAuth tokens, extensions, skills, commands, policies. */
const SHARED = [
  '.env',
  'oauth_creds.json',
  'google_accounts.json',
  'installation_id',
  'mcp-oauth-tokens-v2.json',
  'mcp-oauth-tokens.json',
  'extensions',
  'skills',
  'commands',
  'policies',
]
/** Gemini CLI gives an MCP call ten minutes; 「向群成员提问」 waits for a person up to the group's timeout (a day). */
const ASK_TIMEOUT_MS = 90_000_000

// JSON with line and block comments, as Gemini CLI reads its settings, made plain JSON.
export function stripComments(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else out += c
  }
  return out
}

function userSettings(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  try {
    const v = JSON.parse(stripComments(text))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {}
  process.stderr.write(`${file} is not a JSON object: Gemini runs without the user's settings\n`)
  return {}
}

/** The object at `key`, made one if it is anything else. */
function entry(map, key) {
  if (!map[key] || typeof map[key] !== 'object' || Array.isArray(map[key])) map[key] = {}
  return map[key]
}

/** context.fileName: a name or a list of them. */
function memoryNames(settings) {
  const raw = settings.context?.fileName
  const list =
    typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter((n) => typeof n === 'string') : []
  const names = list.filter((n) => n.trim() && !/[\\/]/.test(n))
  return names.length ? names : ['GEMINI.md']
}

/** Links `at` to the user's `target`; once the user's is gone the link goes too, what Gemini made there stays. */
function share(target, at) {
  let current
  try {
    current = fs.lstatSync(at)
  } catch {}
  if (!fs.existsSync(target)) {
    if (current?.isSymbolicLink()) fs.rmSync(at, { force: true })
    return
  }
  try {
    if (fs.readlinkSync(at) === target) return
  } catch {}
  try {
    if (current) fs.rmSync(at, { recursive: true, force: true })
    if (process.platform === 'win32' && !fs.statSync(target).isDirectory()) fs.copyFileSync(target, at)
    else fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : undefined)
  } catch (e) {
    process.stderr.write(`sharing ${target} with Gemini failed: ${e.message}\n`)
  }
}

export function prepare(run) {
  const own = path.join(run.userHome, '.gemini')
  const ours = path.join(run.state, '.gemini')
  fs.mkdirSync(ours, { recursive: true })
  const settings = userSettings(path.join(own, 'settings.json'))
  // The key and endpoint come with the process env (GEMINI_API_KEY, GOOGLE_GEMINI_BASE_URL).
  if (run.provider) entry(entry(settings, 'security'), 'auth').selectedType = 'gemini-api-key'
  if (run.gonggong) {
    const { name, url, headers } = run.gonggong
    entry(settings, 'mcpServers')[name] = { httpUrl: url, headers, timeout: ASK_TIMEOUT_MS }
  }
  const names = memoryNames(settings)
  // Holds the gonggong server's secret URL.
  const tmp = path.join(ours, 'settings.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, path.join(ours, 'settings.json'))
  // Everything in one file: the bot's instructions first, then the user's global ones under whatever names.
  const user = names
    .map((n) => {
      try {
        return fs.readFileSync(path.join(own, n), 'utf8')
      } catch {
        return ''
      }
    })
    .filter((t) => t.trim())
  fs.writeFileSync(path.join(ours, names[0]), [run.systemPrompt, ...user].join('\n\n'))
  for (const n of names.slice(1)) fs.rmSync(path.join(ours, n), { force: true })
  for (const n of SHARED) share(path.join(own, n), path.join(ours, n))
  // User-level agent skills (~/.agents/skills).
  share(path.join(run.userHome, '.agents'), path.join(run.state, '.agents'))
  return { env: { GEMINI_CLI_HOME: run.state }, args: [] }
}

if (process.argv[1]?.endsWith('launch.mjs')) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(prepare(input)))
}
