import { usePreview } from '../../previews/store'
import type { TabMeta, TabProps } from '../types'
import { LivePreview } from './LiveTab'

/** A mini program's devtools simulator, live, in the workbench (plan 结果预览 §13, B6-2). */
export const MiniprogramTab = ({ tab, tabKey, active }: TabProps<'miniprogram'>) => (
  <LivePreview previewId={tab.previewId} tabKey={tabKey} icon="smartphone" active={active} />
)

export function useMiniprogramTabMeta(tab: TabProps<'miniprogram'>['tab']): TabMeta {
  const state = usePreview(tab.previewId)
  return {
    icon: 'smartphone',
    title: state?.preview?.title ?? '小程序',
    ...(state ? { status: state.status === 'online' ? 'online' : 'offline' } : {}),
  }
}
