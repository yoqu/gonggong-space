import type { AdminTeamDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { PopUpButton } from '../../ui'

/** 管理后台 pages' 团队 filter: '' = every team. Pass `teams` when the parent already loaded `/admin/teams`. */
export function TeamFilter({
  value,
  onChange,
  teams: provided,
}: {
  value: string
  onChange: (teamId: string) => void
  teams?: AdminTeamDto[]
}) {
  const fetched = useGet<AdminTeamDto[]>(provided ? null : '/admin/teams').data
  const teams = provided ?? fetched ?? []
  return (
    <PopUpButton
      aria-label={t('团队')}
      value={value}
      options={[{ value: '', label: t('全部团队') }, ...teams.map((x) => ({ value: x.id, label: x.name }))]}
      onChange={onChange}
    />
  )
}
