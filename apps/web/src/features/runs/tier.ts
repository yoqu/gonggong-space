import type { Tier } from '@aiws/protocol'

export const TIER_LABEL: Record<Tier, string> = {
  'read-only': '只读',
  workspace: '工作区写入',
  full: '完全访问',
}
