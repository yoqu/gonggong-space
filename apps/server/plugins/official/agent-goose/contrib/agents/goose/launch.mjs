// Gonggong launch script for Goose (plan 插件扩展点 §5.2). Its ACP mode takes no per-session instructions, so each
// (group, bot) runs under a GOOSE_PATH_ROOT of its own (`state`): its config folder links to everything in the
// user's (config.yaml, secrets, custom providers) but .goosehints, which holds the bot's instructions before the
// user's own global hints. Its sessions are stored there too.
import fs from 'node:fs'
import path from 'node:path'

const HINTS = '.goosehints'

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
    process.stderr.write(`sharing ${target} with Goose failed: ${e.message}\n`)
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
  const ours = path.join(run.state, 'config')
  fs.mkdirSync(ours, { recursive: true })
  const names = list(own).filter((n) => n !== HINTS)
  for (const n of names) share(path.join(own, n), path.join(ours, n))
  // The user's entry gone: so is the link; what Goose made here stays.
  for (const n of list(ours)) {
    if (n === HINTS || names.includes(n)) continue
    if (fs.lstatSync(path.join(ours, n)).isSymbolicLink()) fs.rmSync(path.join(ours, n), { force: true })
  }
  let user = ''
  try {
    user = fs.readFileSync(path.join(own, HINTS), 'utf8')
  } catch {}
  fs.writeFileSync(path.join(ours, HINTS), [run.systemPrompt, user].filter((t) => t.trim()).join('\n\n'))
  return { env: { GOOSE_PATH_ROOT: run.state }, args: [] }
}

if (process.argv[1]?.endsWith('launch.mjs')) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(prepare(input)))
}
