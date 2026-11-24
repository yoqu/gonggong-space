import type { PreviewDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { ConfirmActionDialog } from '../../ui'

/**
 * Confirms closing a preview, worded as on the desktop's 在线预览 page: `stop` a live one (its link stops working,
 * and with `stopService` its process too), `close` a stopped one for good.
 */
export function ClosePreviewConfirm({
  preview: p,
  mode,
  stopService,
  onDone,
  onClose,
}: {
  preview: Pick<PreviewDto, 'id' | 'title' | 'serviceId'>
  mode: 'stop' | 'close'
  stopService: boolean
  onDone?: () => void
  onClose: () => void
}) {
  return (
    <ConfirmActionDialog
      title={
        mode === 'stop'
          ? t('要停止「{title}」的在线预览吗？', { title: p.title })
          : t('要彻底关闭「{title}」吗？', { title: p.title })
      }
      message={
        mode === 'close'
          ? t('关闭后该预览卡片会移除，之后无法再从这里重新启动。')
          : stopService && p.serviceId
            ? t('停止后，群成员将无法继续打开这个预览链接，相关后台服务也会一并停止。')
            : t('停止后，群成员将无法继续打开这个预览链接。')
      }
      consequences={[]}
      label={mode === 'stop' ? t('停止预览') : t('彻底关闭')}
      done={mode === 'stop' ? t('已停止预览') : t('已关闭预览')}
      run={() => api.post(`/previews/${p.id}/close`, { stopService })}
      onDone={() => {
        onClose()
        onDone?.()
      }}
      onClose={onClose}
    />
  )
}
