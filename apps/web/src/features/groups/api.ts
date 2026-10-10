import type { GroupDto, GroupNoticeDto, GroupParams, GroupPrefsReq, Tier } from '@gonggong/protocol'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'

const apply = (group: GroupDto) => {
  useWorkspace.getState().applyEvent({ t: 'group.updated', group })
  return group
}
const drop = (groupId: string) => useWorkspace.getState().applyEvent({ t: 'group.removed', groupId })

export const groupsApi = {
  update: (id: string, body: { name?: string; notice?: string }) =>
    api.patch<GroupDto>(`/groups/${id}`, body).then(apply),
  removeNotice: (id: string) => api.del<GroupDto>(`/groups/${id}/notice`).then(apply),
  notices: (id: string) => api.get<GroupNoticeDto[]>(`/groups/${id}/notices`),
  setRepo: (id: string, body: { url: string; branch: string }) =>
    api.patch<GroupDto>(`/groups/${id}/repo`, body).then(apply),
  prefs: (id: string, body: GroupPrefsReq) => api.put<GroupDto>(`/groups/${id}/prefs`, body).then(apply),
  params: (id: string) => api.get<GroupParams>(`/groups/${id}/params`),
  saveParams: (id: string, body: GroupParams) => api.put<GroupParams>(`/groups/${id}/params`, body),
  addMembers: (id: string, userIds: string[]) =>
    api.post<GroupDto>(`/groups/${id}/members`, { userIds }).then(apply),
  removeMember: (id: string, userId: string) =>
    api.del<GroupDto>(`/groups/${id}/members/${userId}`).then(apply),
  setAdmin: (id: string, userId: string, on: boolean) =>
    (on ? api.post<GroupDto> : api.del<GroupDto>)(`/groups/${id}/admins/${userId}`).then(apply),
  addBot: (id: string, botId: string) => api.post<GroupDto>(`/groups/${id}/bots`, { botId }).then(apply),
  /** null follows the bot's own tier; the new state arrives as `group.botState`. */
  setBotTier: (id: string, botId: string, tier: Tier | null) =>
    api.put(`/groups/${id}/bots/${botId}/tier`, { tier }),
  removeBot: (id: string, botId: string) => api.del<GroupDto>(`/groups/${id}/bots/${botId}`).then(apply),
  /** Partition → force with `baseBotId`'s tree as the first version (§3.5). */
  enableSync: (id: string, baseBotId: string) =>
    api.post<GroupDto>(`/groups/${id}/sync/enable`, { baseBotId }).then(apply),
  disableSync: (id: string) => api.post<GroupDto>(`/groups/${id}/sync/disable`).then(apply),
  leave: (id: string) => api.post(`/groups/${id}/leave`).then(() => drop(id)),
  dissolve: (id: string) => api.post(`/groups/${id}/dissolve`).then(() => drop(id)),
}

/** Summary shown on the 群级参数 row, e.g. 「审批 30 分 · 接力 3 跳」. */
export const paramsSummary = (p: GroupParams) =>
  t('审批 {min} 分 · 接力 {hops} 跳', { min: p.approvalTimeoutMin, hops: p.chainMaxHops })
