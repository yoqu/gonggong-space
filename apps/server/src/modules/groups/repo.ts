import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ValidateRepoRes } from '@aiws/protocol'

export const REPO_URL = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)\S+$/
export const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/
const TIMEOUT_MS = 15_000

const run = promisify(execFile)

export function repoProblem(url: string, branch: string) {
  if (!REPO_URL.test(url)) return '地址格式不正确，支持 git@ / https:// / ssh://'
  if (!BRANCH.test(branch)) return '基准分支名不正确'
  return null
}

/**
 * Read-only reachability check with the server process's own git credentials — the read-only deploy credential of
 * spec §3.5 (e.g. `GIT_SSH_COMMAND="ssh -i /etc/aiws/deploy_key -o IdentitiesOnly=yes"` or a credential helper).
 * Prompts are disabled so a missing credential fails fast instead of hanging.
 */
export async function checkRepo(url: string, branch: string): Promise<ValidateRepoRes> {
  const problem = repoProblem(url, branch)
  if (problem) return { ok: false, message: problem }
  const ref = `refs/heads/${branch}`
  let stdout: string
  try {
    ;({ stdout } = await run('git', ['ls-remote', '--heads', url, ref], {
      timeout: TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
      },
    }))
  } catch {
    return { ok: false, message: '无法访问该仓库，检查地址与权限' }
  }
  const sha = stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .find(([, name]) => name === ref)?.[0]
  return sha
    ? { ok: true, message: `仓库可访问 · 分支 ${branch} 存在 · 最新提交 ${sha.slice(0, 7)}` }
    : { ok: false, message: `仓库可访问，但分支 ${branch} 不存在` }
}
