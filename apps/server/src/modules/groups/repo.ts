import { REPO_URL } from '@gonggong/protocol'

export const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/

export function repoProblem(url: string, branch: string) {
  if (!REPO_URL.test(url)) return '地址格式不正确，支持 git@ / https:// / http:// / ssh://'
  if (!BRANCH.test(branch)) return '基准分支名不正确'
  return null
}

/**
 * Env for the server process's own git credentials, used only by the base-branch mirrors (plan D14), e.g.
 * `GIT_SSH_COMMAND="ssh -i /etc/gonggong/deploy_key -o IdentitiesOnly=yes"` or a credential helper. Prompts are
 * disabled so a missing credential fails fast instead of hanging.
 */
export const gitEnv = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
})
