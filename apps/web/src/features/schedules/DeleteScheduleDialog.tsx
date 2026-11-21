import { t } from '../../i18n'
import { ConfirmActionDialog } from '../../ui'

export function DeleteScheduleDialog({
  name,
  run,
  onDone,
  onClose,
}: {
  name: string
  run: () => Promise<unknown>
  onDone?: () => void
  onClose: () => void
}) {
  return (
    <ConfirmActionDialog
      title={t('删除定时任务「{name}」？', { name })}
      message={t('删除后不再按计划执行，历史运行记录仍保留在聊天中。')}
      consequences={[t('此操作不可恢复，后续触发计划将立即取消')]}
      label={t('确认删除')}
      done={t('已删除定时任务')}
      run={run}
      onDone={onDone}
      onClose={onClose}
    />
  )
}
