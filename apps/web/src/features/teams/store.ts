import type {
  CreatedTeamInviteDto,
  GroupDto,
  InvitePreviewDto,
  TeamDto,
  TeamInviteDto,
  TeamMemberDto,
  TeamParams,
  TeamRole,
  WebEvent,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { storedTeam, storeTeam } from '../../lib/team'

export const teamsApi = {
  create: (name: string) => api.post<TeamDto>('/teams', { name }),
  update: (id: string, body: { name?: string; avatar?: string | null; params?: TeamParams }) =>
    api.patch<TeamDto>(`/teams/${id}`, body).then(upsertTeam),
  archive: (id: string) => api.post(`/teams/${id}/archive`),
  takeover: (id: string, groupId: string) => api.post<GroupDto>(`/teams/${id}/groups/${groupId}/takeover`),
  members: (id: string) => api.get<TeamMemberDto[]>(`/teams/${id}/members`),
  addMember: (id: string, account: string) => api.post<TeamMemberDto>(`/teams/${id}/members`, { account }),
  setRole: (id: string, userId: string, role: TeamRole) =>
    api.patch<TeamMemberDto>(`/teams/${id}/members/${userId}`, { role }),
  remove: (id: string, userId: string) => api.del(`/teams/${id}/members/${userId}`),
  transfer: (id: string, userId: string) => api.post<TeamMemberDto[]>(`/teams/${id}/transfer`, { userId }),
  invites: (id: string) => api.get<TeamInviteDto[]>(`/teams/${id}/invites`),
  invite: (id: string, body: { role: 'admin' | 'member'; expiresInDays: number; maxUses: number | null }) =>
    api.post<CreatedTeamInviteDto>(`/teams/${id}/invites`, body),
  revokeInvite: (id: string, inviteId: string) => api.del(`/teams/${id}/invites/${inviteId}`),
  preview: (token: string) => api.get<InvitePreviewDto>(`/invites/${token}`),
  accept: (token: string) => api.post<TeamDto>(`/invites/${token}/accept`),
}

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: t('所有者'),
  admin: t('管理员'),
  member: t('成员#role'),
}

export const inviteLink = (token: string) => `${location.origin}/join/${token}`

/** The invite token in a pasted /join link, or the pasted token itself. */
export const tokenOf = (text: string) => text.trim().match(/(?:\/join\/)?([\w-]+)\/?$/)?.[1] ?? ''

function upsertTeam(team: TeamDto) {
  useSession
    .getState()
    .setTeams((list) =>
      list.some((x) => x.id === team.id) ? list.map((x) => (x.id === team.id ? team : x)) : [...list, team],
    )
  return team
}

/** Team-scoped state lives in many stores, so switching reloads the app in the picked team. */
export function switchTeam(id: string, path = '/') {
  storeTeam(id)
  location.assign(path)
}

/** An event about another team than the open one (only its unread counts are kept). */
export const otherTeam = (teamId: string | null) => {
  const current = storedTeam()
  return !!teamId && !!current && teamId !== current
}

let pending: ReturnType<typeof setTimeout> | undefined

/** Re-reads unread counts of my teams, batched; only someone in several teams sees them. */
export function refreshTeamsSoon() {
  if ((useSession.getState().tenancy?.teams.length ?? 0) < 2 || pending) return
  pending = setTimeout(() => {
    pending = undefined
    api.get<TeamDto[]>('/teams').then(
      (teams) => useSession.getState().setTeams(() => teams),
      (e: Error) => console.warn('team unread refresh failed:', e),
    )
  }, 500)
}

export function applyTeamEvent(e: WebEvent) {
  if (e.t === 'team.updated') upsertTeam(e.team)
  else if (e.t === 'team.removed') {
    const rest = (useSession.getState().tenancy?.teams ?? []).filter((x) => x.id !== e.teamId)
    useSession.getState().setTeams(() => rest)
    if (storedTeam() !== e.teamId) return
    storeTeam(rest[0]?.id ?? null)
    location.assign(rest.length ? '/' : '/welcome')
  }
}

/**
 * Opening /g/:groupId that is not in the open team's list (`missing`): a group of another of my teams switches to that
 * team (plan §5); a group of this team I am not in is returned for a team admin's read-only view (plan D19).
 */
export function useGroupOutsideList(groupId: string | undefined, missing: boolean) {
  const [viewed, setViewed] = useState<GroupDto | null>(null)
  useEffect(() => {
    if (!groupId || !missing) return
    let live = true
    api.get<GroupDto>(`/groups/${groupId}`).then(
      (g) => {
        if (!live) return
        if (otherTeam(g.teamId)) switchTeam(g.teamId, `/g/${groupId}`)
        else setViewed(g)
      },
      // Not readable: the chat view already says the group is gone.
      () => {},
    )
    return () => {
      live = false
    }
  }, [groupId, missing])
  return viewed?.id === groupId ? viewed : null
}
