// Gonggong launch script for Kimi Code (plan 插件扩展点 §5.2). Its ACP mode takes no per-session instructions, so
// each (group, bot) runs with a KIMI_CODE_HOME of its own (`state`): links to everything in the user's home (logins,
// config, skills, sessions) but AGENTS.md, which holds the bot's instructions before the user's own global ones.
import fs from 'node:fs'
import path from 'node:path'

const MEMORY = 'AGENTS.md'

/** Links `at` to the user's `target`, replacing what is there. */
function share(target, at) {
  try {
    if (fs.readlinkSync(at) === target) return
  } catch {}
  try {
    fs.rmSync(at, { recursive: true, force: true })
    if (process.platform === 'win32' && !fs.statSync(target).isDirectory()) fs.copyFileSync(target, at)
    else fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : undefined)
  } catch (e) {
    process.stderr.write(`sharing ${target} with Kimi Code failed: ${e.message}\n`)
  }
}

const list = (dir) => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

export function prepare(run) {
  const own = run.home
  const ours = path.join(run.state, 'home')
  fs.mkdirSync(ours, { recursive: true })
  const names = list(own).filter((n) => n !== MEMORY)
  for (const n of names) share(path.join(own, n), path.join(ours, n))
  // The user's entry gone: so is the link; what Kimi Code made here stays.
  for (const n of list(ours)) {
    if (n === MEMORY || names.includes(n)) continue
    if (fs.lstatSync(path.join(ours, n)).isSymbolicLink()) fs.rmSync(path.join(ours, n), { force: true })
  }
  let user = ''
  try {
    user = fs.readFileSync(path.join(own, MEMORY), 'utf8')
  } catch {}
  fs.writeFileSync(path.join(ours, MEMORY), [run.systemPrompt, user].filter((t) => t.trim()).join('\n\n'))
  return { env: { KIMI_CODE_HOME: ours }, args: [] }
}

if (process.argv[1]?.endsWith('launch.mjs')) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(prepare(input)))
}
