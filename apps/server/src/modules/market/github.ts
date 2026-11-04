import type { ListingSource, SkillFile } from '@gonggong/protocol'
import { fail } from '../../lib/errors.js'

// Placeholder until the GitHub import slice lands; the integrator replaces this file.
export async function fetchGithubSkill(
  _url: string,
  _opts?: { fetch?: typeof fetch },
): Promise<{ files: SkillFile[]; source: ListingSource }> {
  return fail('invalid', '暂不可用')
}

export async function upstreamCommit(
  _source: ListingSource,
  _opts?: { fetch?: typeof fetch },
): Promise<string> {
  return fail('invalid', '暂不可用')
}
