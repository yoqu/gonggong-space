// Gonggong launch script for pi (plan 插件扩展点 §5.2). pi runs through the pinned pi-acp adapter, which starts
// `pi --mode rpc` itself (PI_ACP_PI_COMMAND): a wrapper adds gonggong's extension (gonggong.ts next to this file) and
// trusts the project, as the other agents do, so the team skills linked into .agents/skills load. The extension
// takes the run's MCP servers and the bot's instructions from the env (declared in the manifest).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WINDOWS = process.platform === 'win32'
const WRAPPER = WINDOWS
  ? [
      'pi-gonggong.cmd',
      '@echo off\r\nif defined GG_PI_SCRIPT (\r\n  "%GG_PI_EXE%" "%GG_PI_SCRIPT%" --approve -e "%GG_PI_EXTENSION%" %*\r\n) else (\r\n  "%GG_PI_EXE%" --approve -e "%GG_PI_EXTENSION%" %*\r\n)\r\n',
    ]
  : [
      'pi-gonggong',
      '#!/bin/sh\nif [ -n "$GG_PI_SCRIPT" ]; then\n  exec "$GG_PI_EXE" "$GG_PI_SCRIPT" --approve -e "$GG_PI_EXTENSION" "$@"\nfi\nexec "$GG_PI_EXE" --approve -e "$GG_PI_EXTENSION" "$@"\n',
    ]

export function prepare(run) {
  fs.mkdirSync(run.data, { recursive: true })
  const wrapper = path.join(run.data, WRAPPER[0])
  let current
  try {
    current = fs.readFileSync(wrapper, 'utf8')
  } catch {}
  if (current !== WRAPPER[1]) fs.writeFileSync(wrapper, WRAPPER[1])
  if (!WINDOWS) fs.chmodSync(wrapper, 0o755)
  const env = {
    PI_ACP_PI_COMMAND: wrapper,
    // pi's npm script runs on the daemon's Node; a native build as it is.
    GG_PI_EXE: run.cliScript ? run.node : (run.cli ?? run.bin),
    GG_PI_EXTENSION: path.join(path.dirname(fileURLToPath(import.meta.url)), 'gonggong.ts'),
  }
  if (run.cliScript) env.GG_PI_SCRIPT = run.cliScript
  return { env, args: [] }
}

if (process.argv[1]?.endsWith('launch.mjs')) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(prepare(input)))
}
