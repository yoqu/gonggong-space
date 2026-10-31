import type {
  CreateGroupDesignSystemReq,
  CreationStep,
  GroupDesignSystemDto,
  GroupPluginDto,
  MessageDto,
} from '@gonggong/protocol'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { api } from '../../lib/api'
import type { CreationDraft } from './model'

/**
 * Each group's plugins (GET /groups/:id/plugins), loaded on first use. Empty while the master switch is off, and
 * also when the request fails (an older server): the chat then looks exactly as without plugins.
 */
export const usePluginStore = create<{ lists: Record<string, GroupPluginDto[]> }>()(() => ({ lists: {} }))
const loading = new Set<string>()

export function loadPlugins(groupId: string) {
  if (loading.has(groupId)) return
  loading.add(groupId)
  const done = (list: GroupPluginDto[]) =>
    usePluginStore.setState((s) => ({ lists: { ...s.lists, [groupId]: list } }))
  api
    .get<GroupPluginDto[]>(`/groups/${groupId}/plugins`)
    .then(done, () => done([]))
    .finally(() => loading.delete(groupId))
}

/** Undefined until loaded. */
export function useGroupPlugins(groupId: string) {
  const list = usePluginStore((s) => s.lists[groupId])
  useEffect(() => {
    if (!list) loadPlugins(groupId)
  }, [groupId, list])
  return list
}

/** Plugins turned on in the group: what 创作 offers. Reads what the chat view (useGroupPlugins) loaded. */
export function useEnabledPlugins(groupId: string) {
  const list = usePluginStore((s) => s.lists[groupId])
  return useMemo(() => list?.filter((p) => p.enabledInGroup) ?? [], [list])
}

export function putPlugin(groupId: string, p: GroupPluginDto) {
  usePluginStore.setState((s) => ({
    lists: { ...s.lists, [groupId]: (s.lists[groupId] ?? []).map((x) => (x.id === p.id ? p : x)) },
  }))
}

export async function togglePlugin(groupId: string, pluginId: string, enabled: boolean) {
  putPlugin(groupId, await api.put<GroupPluginDto>(`/groups/${groupId}/plugins/${pluginId}`, { enabled }))
}

export const createInGroup = (groupId: string, body: unknown) =>
  api.post<MessageDto>(`/groups/${groupId}/creations`, body)

export const dismissDraft = (groupId: string, messageId: string) =>
  api.post<void>(`/groups/${groupId}/creation-drafts/${messageId}/dismiss`, {})

/** The open 创作 panel: a plugin to preselect, or a whole draft to start from (改参数重做, a bot's 创作确认卡). */
export interface CreationOpen {
  groupId: string
  pluginId?: string
  draft?: CreationDraft
  step?: CreationStep
}
export const useCreation = create<{ open: CreationOpen | null }>()(() => ({ open: null }))
export const openCreation = (open: CreationOpen) => useCreation.setState({ open })
export const closeCreation = () => useCreation.setState({ open: null })

/** Design systems the group imported (「导入我的设计」), loaded when a prompt-first composer opens. */
export const useDesignSystems = create<{ lists: Record<string, GroupDesignSystemDto[]> }>()(() => ({
  lists: {},
}))
const setDesignSystems = (groupId: string, list: GroupDesignSystemDto[]) =>
  useDesignSystems.setState((s) => ({ lists: { ...s.lists, [groupId]: list } }))

export function useGroupDesignSystems(groupId: string) {
  const list = useDesignSystems((s) => s.lists[groupId])
  useEffect(() => {
    api.get<GroupDesignSystemDto[]>(`/groups/${groupId}/design-systems`).then(
      (l) => setDesignSystems(groupId, l),
      () => setDesignSystems(groupId, []),
    )
  }, [groupId])
  return list ?? []
}

export async function importDesignSystem(groupId: string, body: CreateGroupDesignSystemReq) {
  const ds = await api.post<GroupDesignSystemDto>(`/groups/${groupId}/design-systems`, body)
  setDesignSystems(groupId, [ds, ...(useDesignSystems.getState().lists[groupId] ?? [])])
  return ds
}

export async function deleteDesignSystem(groupId: string, id: string) {
  await api.del(`/groups/${groupId}/design-systems/${id}`)
  setDesignSystems(
    groupId,
    (useDesignSystems.getState().lists[groupId] ?? []).filter((d) => d.id !== id),
  )
}
