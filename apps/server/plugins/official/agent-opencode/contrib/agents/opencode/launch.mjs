// Gonggong launch script for OpenCode (plan 插件扩展点 §5.2). Its ACP mode takes no per-session instructions: the
// bot's go into a file of the (group, bot) state folder, listed by an inline config (OPENCODE_CONFIG_CONTENT) that
// OpenCode loads over the user's own.
import fs from 'node:fs'
import path from 'node:path'

export function prepare(run) {
  fs.mkdirSync(run.state, { recursive: true })
  const file = path.join(run.state, 'instructions.md')
  fs.writeFileSync(file, run.systemPrompt)
  return { env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [file] }) }, args: [] }
}

if (process.argv[1]?.endsWith('launch.mjs')) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(prepare(input)))
}
