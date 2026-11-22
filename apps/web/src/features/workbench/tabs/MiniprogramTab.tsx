import { t } from '../../../i18n'
import type { TabMeta, TabProps } from '../types'
import { LivePreview } from './LiveTab'
import { usePreviewTabMeta } from './previewTab'

/** A mini program's devtools simulator, live, in the workbench (plan 结果预览 §13, B6-2). */
export const MiniprogramTab = ({ tab, tabKey, active }: TabProps<'miniprogram'>) => (
  <LivePreview previewId={tab.previewId} tabKey={tabKey} icon="smartphone" active={active} />
)

export function useMiniprogramTabMeta(tab: TabProps<'miniprogram'>['tab']): TabMeta {
  return usePreviewTabMeta(tab.previewId, 'smartphone', t('小程序'))
}
