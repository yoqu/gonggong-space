// Gonggong launch script for GitHub Copilot CLI (plan 插件扩展点 §5.2). Its ACP mode takes no per-session
// instructions: the bot's go into an AGENTS.md of the (group, bot) state folder, an extra custom instructions
// directory (COPILOT_CUSTOM_INSTRUCTIONS_DIRS) read with the user's and the repo's own.
import fs from 'node:fs'
import path from 'node:path'

export function prepare(run) {
  const dir = path.join(run.state, 'instructions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), run.systemPrompt)
  return { env: { COPILOT_CUSTOM_INSTRUCTIONS_DIRS: dir }, args: [] }
}

if (process.argv[1]?.endsWith('launch.mjs')) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(prepare(input)))
}
