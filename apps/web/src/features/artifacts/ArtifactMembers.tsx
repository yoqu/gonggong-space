import type { ArtifactAccess, ArtifactMemberDto, TeamMemberDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Alert, Avatar, Button, Select, Spinner, toast } from '../../ui'
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
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const busy = busyKey !== null
  useEffect(() => setMembers(loaded.data), [loaded.data])

  const save = async (
    userId: string,
    next: ArtifactAccess | null,
    name: string,
    key: string,
    mode: 'add' | 'change' | 'remove',
  ) => {
    setBusyKey(key)
    try {
      const url = `/artifacts/${artifactId}/members/${userId}`
      setMembers(
        next
          ? await api.put<ArtifactMemberDto[]>(url, { role: next })
          : await api.del<ArtifactMemberDto[]>(url),
      )
      toast({
        type: 'success',
        message:
          mode === 'add'
            ? t('已授权 {name}', { name })
            : mode === 'change'
              ? t('已更新 {name} 的权限', { name })
              : t('已移除 {name} 的权限', { name }),
      })
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setBusyKey(null)
    }
  }
  const add = async () => {
    if (!pick) return
    const name = candidates.find((c) => c.value === pick)?.label ?? ''
    if (await save(pick, role, name, 'add', 'add')) setPick(null)
  }

  const given = new Set(members?.map((m) => m.userId))
  const candidates = (team.data ?? [])
    .filter((m) => m.userId !== createdBy && !given.has(m.userId))
    .map((m) => ({ value: m.userId, label: m.name }))
  const noCandidates = !candidates.length

  return (
    <div className="art-share__scope art-members">
      <strong>{t('成员权限')}</strong>
      <small>{t('单独授权团队里的人，不用进群：可看只能查看，可协作能和群成员一样修改')}</small>
      {loaded.error && !members ? (
        <Alert variant="error" title={t('加载失败')} description={loaded.error} onRetry={loaded.reload} />
      ) : loaded.loading && !members ? (
        <Spinner size={14} />
      ) : members?.length ? (
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
                    onChange={(v) => void save(m.userId, v, m.name, `role:${m.userId}`, 'change')}
                  />
                  <Button
                    size="small"
                    variant="plain"
                    icon="xmark"
                    aria-label={t('移除 {name}', { name: m.name })}
                    loading={busyKey === `rm:${m.userId}`}
                    disabled={busy}
                    onClick={() => void save(m.userId, null, m.name, `rm:${m.userId}`, 'remove')}
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
        <>
          {team.error ? (
            <Alert
              variant="error"
              title={t('成员列表加载失败')}
              description={team.error}
              onRetry={team.reload}
            />
          ) : null}
          <div className="art-members__add">
            <Select
              label={t('选择成员')}
              placeholder={t('选择成员')}
              options={candidates}
              value={pick}
              disabled={busy || noCandidates}
              onChange={setPick}
            />
            <Select<ArtifactAccess>
              label={t('权限')}
              options={ROLES}
              value={role}
              disabled={busy || noCandidates}
              onChange={setRole}
            />
            <Button
              size="small"
              loading={busyKey === 'add'}
              disabled={busy || !pick}
              onClick={() => void add()}
            >
              {t('添加')}
            </Button>
          </div>
          {team.data && noCandidates ? <small>{t('团队里其他成员均已授权')}</small> : null}
        </>
      ) : null}
    </div>
  )
}
