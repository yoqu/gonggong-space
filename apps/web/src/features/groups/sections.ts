import {
  type ChannelDto,
  type DirectoryGroupDto,
  type GroupDto,
  type JoinRequestDto,
  type SidebarSectionDto,
  sectionSubtree,
  type TeamSectionsDto,
} from '@gonggong/protocol'
import { create } from 'zustand'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { groupsApi } from './api'

/** Every section id in order, with `id` swapped with its previous (-1) or next (1) sibling; null at the ends. */
function swapped(list: SidebarSectionDto[], id: string, by: -1 | 1) {
  const me = list.find((x) => x.id === id)
  const siblings = list.filter((x) => x.parentId === me?.parentId)
  const other = siblings[siblings.findIndex((x) => x.id === id) + by]
  if (!me || !other) return null
  return list.map((x) => (x.id === id ? other.id : x.id === other.id ? id : x.id))
}

/** 侧栏自建分区: my own sidebar sections in this team, in order. */
export const useSections = create<{ sections: SidebarSectionDto[] }>()(() => ({ sections: [] }))

export async function loadSections() {
  useSections.setState({ sections: await api.get<SidebarSectionDto[]>('/sidebar-sections') })
}

export const sectionsApi = {
  async create(name: string, parentId?: string) {
    const sec = await api.post<SidebarSectionDto>('/sidebar-sections', { name, parentId })
    useSections.setState((s) => ({ sections: [...s.sections, sec] }))
    return sec
  },
  async rename(id: string, name: string) {
    const sec = await api.patch<SidebarSectionDto>(`/sidebar-sections/${id}`, { name })
    useSections.setState((s) => ({ sections: s.sections.map((x) => (x.id === id ? sec : x)) }))
  },
  async move(id: string, by: -1 | 1) {
    const ids = swapped(useSections.getState().sections, id, by)
    if (ids)
      useSections.setState({
        sections: await api.put<SidebarSectionDto[]>('/sidebar-sections/order', { ids }),
      })
  },
  async remove(id: string) {
    await api.del<void>(`/sidebar-sections/${id}`)
    const gone = new Set(sectionSubtree(useSections.getState().sections, id))
    useSections.setState((s) => ({ sections: s.sections.filter((x) => !gone.has(x.id)) }))
    // The server sends their conversations back to their default sections.
    useWorkspace.setState((s) => ({
      groups: s.groups.map((g) => (g.sectionId && gone.has(g.sectionId) ? { ...g, sectionId: null } : g)),
    }))
  },
  /** Files a conversation under one of my sections, or back to its default one (null). */
  file: (groupId: string, sectionId: string | null) => groupsApi.prefs(groupId, { sectionId }),
}

export const channelsApi = {
  list: (q = '') => api.get<ChannelDto[]>(`/channels${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
  async join(id: string) {
    const group = await api.post<GroupDto>(`/groups/${id}/join`, {})
    useWorkspace.getState().applyEvent({ t: 'group.updated', group })
    return group
  },
}

/** 团队分区 and the groups filed under them that I have not joined. */
export const useTeamSections = create<{
  sections: SidebarSectionDto[]
  canManage: boolean
  directory: DirectoryGroupDto[]
}>()(() => ({ sections: [], canManage: false, directory: [] }))

export async function loadTeamSections() {
  const [{ sections, canManage }, directory] = await Promise.all([
    api.get<TeamSectionsDto>('/team-sections'),
    api.get<DirectoryGroupDto[]>('/team-directory'),
  ])
  useTeamSections.setState({ sections, canManage, directory })
}

const reloadTeam = () => loadTeamSections()

export const teamSectionsApi = {
  create: (name: string, parentId?: string) =>
    api.post<SidebarSectionDto>('/team-sections', { name, parentId }).then(reloadTeam),
  rename: (id: string, name: string) => api.patch(`/team-sections/${id}`, { name }).then(reloadTeam),
  async move(id: string, by: -1 | 1) {
    const ids = swapped(useTeamSections.getState().sections, id, by)
    if (!ids) return
    await api.put('/team-sections/order', { ids })
    await reloadTeam()
  },
  async remove(id: string) {
    await api.del<void>(`/team-sections/${id}`)
    const gone = new Set(sectionSubtree(useTeamSections.getState().sections, id))
    useWorkspace.setState((s) => ({
      groups: s.groups.map((g) =>
        g.teamSectionId && gone.has(g.teamSectionId) ? { ...g, teamSectionId: null } : g,
      ),
    }))
    await reloadTeam()
  },
  /** Files a group under a 团队分区 for the whole team, or takes it out (null). */
  file: (groupId: string, teamSectionId: string | null) =>
    api.put<GroupDto>(`/groups/${groupId}/team-section`, { teamSectionId }).then((group) => {
      useWorkspace.getState().applyEvent({ t: 'group.updated', group })
      return group
    }),
  async request(groupId: string, note: string) {
    await api.post<JoinRequestDto>(`/groups/${groupId}/join-requests`, { note })
    await reloadTeam()
  },
  async cancel(requestId: string) {
    await api.del<void>(`/join-requests/${requestId}`)
    await reloadTeam()
  },
  /** Joins a public group straight from its preview. */
  async join(groupId: string) {
    const group = await channelsApi.join(groupId)
    await reloadTeam()
    return group
  },
  requests: (groupId: string) => api.get<JoinRequestDto[]>(`/groups/${groupId}/join-requests`),
  decide: (requestId: string, approve: boolean) =>
    api.post(`/join-requests/${requestId}/${approve ? 'approve' : 'reject'}`, {}),
}
