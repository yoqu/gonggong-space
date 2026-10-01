import type { AdminTeamDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { PopUpButton } from '../../ui'

/** 管理后台 pages' 团队 filter: '' = every team. */
export function TeamFilter({ value, onChange }: { value: string; onChange: (teamId: string) => void }) {
  const teams = useGet<AdminTeamDto[]>('/admin/teams').data ?? []
  return (
    <PopUpButton
      aria-label={t('团队')}
      value={value}
      options={[{ value: '', label: t('全部团队') }, ...teams.map((x) => ({ value: x.id, label: x.name }))]}
      onChange={onChange}
    />
  )
}
