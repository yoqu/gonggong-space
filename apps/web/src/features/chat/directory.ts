import type { GroupCandidatesDto } from '@aiws/protocol'
import { create } from 'zustand'
import { api } from '../../lib/api'

export type DirectoryBot = GroupCandidatesDto['bots'][number]

/** Team people and bots: names for timeline rendering, choices for new groups. */
interface DirectoryState extends GroupCandidatesDto {
  load: () => Promise<void>
}

export const useDirectory = create<DirectoryState>()((set) => ({
  users: [],
  bots: [],
  async load() {
    set(await api.get<GroupCandidatesDto>('/groups/candidates'))
  },
}))

export const AGENT_LABEL = { claude: 'Claude Code', codex: 'Codex' } as const
