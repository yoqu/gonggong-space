import { useWorkbench } from '../../../app/workbench'
import { t } from '../../../i18n'
import { Button, EmptyState, type IconName } from '../../../ui'
import { usePreview } from '../../previews/store'
import type { TabMeta } from '../types'

export function usePreviewTabMeta(previewId: string, icon: IconName, fallback: string): TabMeta {
  const state = usePreview(previewId)
  return {
    icon,
    title: state?.preview?.title ?? fallback,
    ...(state ? { status: state.status === 'online' ? 'online' : 'offline' } : {}),
  }
}

export function PreviewClosed({ icon, tabKey }: { icon: IconName; tabKey: string }) {
  return (
    <EmptyState
      icon={icon}
      title={t('预览已关闭')}
      action={<Button onClick={() => useWorkbench.getState().closeTab(tabKey)}>{t('关闭标签页')}</Button>}
    />
  )
}
