import type { GroupDto, GroupParams, GroupPrefsReq } from '@gonggong/protocol'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'

const apply = (group: GroupDto) => {
  useWorkspace.getState().applyEvent({ t: 'group.updated', group })
  return group
}
const drop = (groupId: string) => useWorkspace.getState().applyEvent({ t: 'group.removed', groupId })

export const groupsApi = {
  update: (id: string, body: { name?: string; notice?: string }) =>
    api.patch<GroupDto>(`/groups/${id}`, body).then(apply),
  setRepo: (id: string, body: { url: string; branch: string }) =>
    api.patch<GroupDto>(`/groups/${id}/repo`, body).then(apply),
  prefs: (id: string, body: GroupPrefsReq) => api.put<GroupDto>(`/groups/${id}/prefs`, body).then(apply),
  params: (id: string) => api.get<GroupParams>(`/groups/${id}/params`),
  saveParams: (id: string, body: GroupParams) => api.put<GroupParams>(`/groups/${id}/params`, body),
  addMember: (id: string, userId: string) =>
    api.post<GroupDto>(`/groups/${id}/members`, { userId }).then(apply),
  removeMember: (id: string, userId: string) =>
    api.del<GroupDto>(`/groups/${id}/members/${userId}`).then(apply),
  setAdmin: (id: string, userId: string, on: boolean) =>
    (on ? api.post<GroupDto> : api.del<GroupDto>)(`/groups/${id}/admins/${userId}`).then(apply),
  addBot: (id: string, botId: string) => api.post<GroupDto>(`/groups/${id}/bots`, { botId }).then(apply),
  removeBot: (id: string, botId: string) => api.del<GroupDto>(`/groups/${id}/bots/${botId}`).then(apply),
  leave: (id: string) => api.post(`/groups/${id}/leave`).then(() => drop(id)),
  dissolve: (id: string) => api.post(`/groups/${id}/dissolve`).then(() => drop(id)),
}

/** Summary shown on the 群级参数 row, e.g. 「审批 30 分 · 接力 3 跳」. */
export const paramsSummary = (p: GroupParams) => `审批 ${p.approvalTimeoutMin} 分 · 接力 ${p.chainMaxHops} 跳`
