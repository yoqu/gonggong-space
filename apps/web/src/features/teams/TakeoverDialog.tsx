import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ConfirmActionDialog } from '../../ui'
import { teamsApi } from './store'

/** Plan D19: a team admin joins a group of the team as its group admin before managing it. */
export function TakeoverDialog({
  teamId,
  group,
  onDone,
  onClose,
}: {
  teamId: string
  group: { id: string; name: string }
  onDone: () => void
  onClose: () => void
}) {
  return (
    <ConfirmActionDialog
      title={t('进群并成为「{name}」的群管理员？', { name: group.name })}
      message={t('群由群管理员管理。你将以团队管理员身份加入该群并成为群管理员。')}
      consequences={[t('群内会显示一条加入记录'), t('操作写入团队审计')]}
      label={t('进群并成为管理员')}
      done={t('已进群并成为群管理员')}
      run={async () =>
        useWorkspace
          .getState()
          .applyEvent({ t: 'group.updated', group: await teamsApi.takeover(teamId, group.id) })
      }
      onDone={onDone}
      onClose={onClose}
    />
  )
}
