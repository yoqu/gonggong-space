import type { ArtifactAccess, ArtifactMemberDto, TeamMemberDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Avatar, Button, Select } from '../../ui'
import './members.css'

const ROLES: { value: ArtifactAccess; label: string }[] = [
  { value: 'view', label: t('可看') },
  { value: 'edit', label: t('可协作') },
]

/**
 * 成员权限: people of the team given 可看 or 可协作 on this work whether in its group or not. Its managers add, change
 * and remove them; everyone else sees the list.
 */
export function ArtifactMembers({
  artifactId,
  teamId,
  createdBy,
  canManage,
}: {
  artifactId: string
  teamId: string | undefined
  createdBy: string | null
  canManage: boolean
}) {
  const loaded = useGet<ArtifactMemberDto[]>(`/artifacts/${artifactId}/members`)
  const team = useGet<TeamMemberDto[]>(canManage && teamId ? `/teams/${teamId}/members` : null)
  const [members, setMembers] = useState<ArtifactMemberDto[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [role, setRole] = useState<ArtifactAccess>('edit')
  const [busy, setBusy] = useState(false)
  useEffect(() => setMembers(loaded.data), [loaded.data])

  const save = async (userId: string, next: ArtifactAccess | null) => {
    setBusy(true)
    try {
      const url = `/artifacts/${artifactId}/members/${userId}`
      setMembers(
        next
          ? await api.put<ArtifactMemberDto[]>(url, { role: next })
          : await api.del<ArtifactMemberDto[]>(url),
      )
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    if (pick && (await save(pick, role))) setPick(null)
  }

  const given = new Set(members?.map((m) => m.userId))
  const candidates = (team.data ?? [])
    .filter((m) => m.userId !== createdBy && !given.has(m.userId))
    .map((m) => ({ value: m.userId, label: m.name }))

  return (
    <div className="art-share__scope art-members">
      <strong>{t('成员权限')}</strong>
      <small>{t('单独授权团队里的人，不用进群：可看只能查看，可协作能和群成员一样修改')}</small>
      {members?.length ? (
        <ul className="art-members__list" aria-label={t('成员权限')}>
          {members.map((m) => (
            <li key={m.userId} className="art-members__row">
              <Avatar name={m.name} src={m.avatar ?? undefined} size={24} />
              <span className="art-members__name">{m.name}</span>
              {canManage ? (
                <>
                  <Select<ArtifactAccess>
                    label={t('{name} 的权限', { name: m.name })}
                    options={ROLES}
                    value={m.role}
                    disabled={busy}
                    onChange={(v) => void save(m.userId, v)}
                  />
                  <Button
                    size="small"
                    variant="plain"
                    icon="xmark"
                    aria-label={t('移除 {name}', { name: m.name })}
                    disabled={busy}
                    onClick={() => void save(m.userId, null)}
                  />
                </>
              ) : (
                <span className="art-members__role">{ROLES.find((r) => r.value === m.role)?.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : members ? (
        <small>{t('还没有单独授权的人')}</small>
      ) : null}
      {canManage ? (
        <div className="art-members__add">
          <Select
            label={t('选择成员')}
            placeholder={t('选择成员')}
            options={candidates}
            value={pick}
            disabled={busy || !candidates.length}
            onChange={setPick}
          />
          <Select<ArtifactAccess> label={t('权限')} options={ROLES} value={role} onChange={setRole} />
          <Button size="small" disabled={!pick || busy} onClick={() => void add()}>
            {t('添加')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
