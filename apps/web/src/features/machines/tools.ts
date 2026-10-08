import { compareVersions, type ToolKind } from '@gonggong/protocol'

export const hasUpdate = (t: { version?: string | null; latest?: string | null }) =>
  !!(t.latest && t.version && compareVersions(t.latest, t.version) > 0)

/** Gonggong does not upgrade a CLI the user installed; this is the command for them to run themselves. */
export function selfUpgradeCommand(kind: ToolKind, path: string | null): string | null {
  if (kind === 'node') return null
  const brew = !!path && /\/(homebrew|linuxbrew|Cellar|Caskroom)\//.test(path)
  if (kind === 'claude') return brew ? 'brew upgrade claude-code' : 'claude update'
  return brew ? 'brew upgrade codex' : 'npm i -g @openai/codex@latest'
}
