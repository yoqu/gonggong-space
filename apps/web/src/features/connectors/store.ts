import type { ConnectorDto, ConnectorList } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { ApiError, api, errorText } from '../../lib/api'

/** Each group's connectors (GET /groups/:id/connectors), with whether I connected each. */
export const useConnectorStore = create<{
  lists: Record<string, ConnectorDto[]>
  errors: Record<string, string | null>
}>()(() => ({ lists: {}, errors: {} }))

const setList = (groupId: string, list: ConnectorDto[]) =>
  useConnectorStore.setState((s) => ({
    lists: { ...s.lists, [groupId]: list },
    errors: { ...s.errors, [groupId]: null },
  }))

export function loadConnectors(groupId: string) {
  return api.get<ConnectorList>(`/groups/${groupId}/connectors`).then(
    (r) => setList(groupId, r.connectors),
    (e) =>
      // An older server without the endpoint: no connectors.
      e instanceof ApiError && e.status === 404
        ? setList(groupId, [])
        : useConnectorStore.setState((s) => ({ errors: { ...s.errors, [groupId]: errorText(e) } })),
  )
}

/** The group's connectors, loaded once per mount; undefined until loaded. */
export function useConnectors(groupId: string, enabled = true) {
  const list = useConnectorStore((s) => s.lists[groupId])
  useEffect(() => {
    if (enabled) void loadConnectors(groupId)
  }, [groupId, enabled])
  return list
}

export async function connect(groupId: string, pluginId: string, values: Record<string, string>) {
  const c = await api.post<ConnectorDto>(`/groups/${groupId}/connectors/${pluginId}/connect`, { values })
  setList(
    groupId,
    (useConnectorStore.getState().lists[groupId] ?? []).map((x) => (x.id === c.id ? c : x)),
  )
}

/** Disconnecting deletes my values of its secrets, which may also cut off other connectors: reload them all. */
export async function disconnect(groupId: string, pluginId: string) {
  await api.del(`/groups/${groupId}/connectors/${pluginId}/connection`)
  await loadConnectors(groupId)
}

/** The connector title behind an MCP server `<plugin name>-<mcp name>`, from any group's loaded connectors. */
export function connectorOfServer(server: string) {
  for (const list of Object.values(useConnectorStore.getState().lists))
    for (const c of list)
      if (c.manifest.contributes.mcp.some((m) => `${c.manifest.name}-${m.name}` === server))
        return c.manifest.title
  return undefined
}

/** The connector title behind a command that runs a script of a connector's entry skill (a skill-based connector). */
export function connectorOfCommand(command: string) {
  for (const list of Object.values(useConnectorStore.getState().lists))
    for (const c of list)
      if (c.manifest.entry && command.includes(`/skills/${c.manifest.entry}/`)) return c.manifest.title
  return undefined
}
