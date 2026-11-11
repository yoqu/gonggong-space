// Gonggong launch script for DeepSeek Harness (plan 插件扩展点 §5.2). It takes no per-session instructions: the
// bot's go into its system prompt, as a patch of the acp profile's persona (the profile's own line first), loaded
// with the process.
import fs from 'node:fs'
import path from 'node:path'

export function prepare(run) {
  const persona = `You are a coding agent powered by the {{model}} model.\n\n${run.systemPrompt}`
  // JSON is YAML: no escaping of our own.
  const patch = [{ id: 'system-prompt', config: { personaPrefix: persona } }]
  fs.mkdirSync(run.state, { recursive: true })
  const file = path.join(run.state, 'system-prompt.yml')
  fs.writeFileSync(file, JSON.stringify(patch))
  return { env: {}, args: ['--patch', file] }
}

if (process.argv[1]?.endsWith('launch.mjs')) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(prepare(input)))
}
