import type { ChannelDto, GroupDto, SidebarSectionDto } from '@gonggong/protocol'
import { create } from 'zustand'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { groupsApi } from './api'

/** 侧栏自建分区: my own sidebar sections in this team, in order. */
export const useSections = create<{ sections: SidebarSectionDto[] }>()(() => ({ sections: [] }))

export async function loadSections() {
  useSections.setState({ sections: await api.get<SidebarSectionDto[]>('/sidebar-sections') })
}

export const sectionsApi = {
  async create(name: string) {
    const sec = await api.post<SidebarSectionDto>('/sidebar-sections', { name })
    useSections.setState((s) => ({ sections: [...s.sections, sec] }))
    return sec
  },
  async rename(id: string, name: string) {
    const sec = await api.patch<SidebarSectionDto>(`/sidebar-sections/${id}`, { name })
    useSections.setState((s) => ({ sections: s.sections.map((x) => (x.id === id ? sec : x)) }))
  },
  async move(id: string, by: -1 | 1) {
    const ids = useSections.getState().sections.map((s) => s.id)
    const at = ids.indexOf(id)
    const to = at + by
    if (at < 0 || to < 0 || to >= ids.length) return
    ;[ids[at], ids[to]] = [ids[to] as string, id]
    useSections.setState({ sections: await api.put<SidebarSectionDto[]>('/sidebar-sections/order', { ids }) })
  },
  async remove(id: string) {
    await api.del<void>(`/sidebar-sections/${id}`)
    useSections.setState((s) => ({ sections: s.sections.filter((x) => x.id !== id) }))
    // The server sends its conversations back to their default sections.
    useWorkspace.setState((s) => ({
      groups: s.groups.map((g) => (g.sectionId === id ? { ...g, sectionId: null } : g)),
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
