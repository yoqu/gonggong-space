import { useEffect, useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { api } from '../../../lib/api'
import { Button, EmptyState, TextField, toast } from '../../../ui'
import { errorText } from '../../auth/AuthCard'
import '../../previews/previews.css'
import { DevtoolsLogin, loginNote, PREVIEW_STATE } from '../../previews/PreviewCard'
import { snapshotUrl, usePreview } from '../../previews/store'
import type { TabMeta, TabProps } from '../types'
import './miniprogram-tab.css'

/**
 * A mini program preview in the workbench (plan 结果预览 §13): the machine's devtools simulator as last captured. The
 * bot owner or a group admin retakes it or moves it to another page; the card follows.
 */
export function MiniprogramTab({ tab, tabKey: key }: TabProps<'miniprogram'>) {
  const state = usePreview(tab.previewId)
  const p = state?.preview
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(p?.path.replace(/^\//, '') ?? ''), [p?.path])

  const capture = async (path?: string) => {
    setBusy(true)
    try {
      await api.post(`/previews/${tab.previewId}/snapshot`, path ? { path } : undefined)
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const go = () => {
    const page = draft.trim().replace(/^\//, '')
    if (page) void capture(`/${page}`)
  }

  return (
    <div className="wt-mp">
      <div className="wt-mp__bar">
        {p?.canManage ? (
          <Button
            size="small"
            variant="plain"
            icon="arrow-clockwise"
            aria-label="刷新截图"
            title="重新截取模拟器画面"
            disabled={busy || state?.status !== 'online'}
            onClick={() => void capture()}
          />
        ) : null}
        <TextField
          className="wt-mp__page"
          size="regular"
          aria-label="页面"
          prefix="页面"
          title={p?.canManage ? '回车后在模拟器里打开这个页面并重新截图' : undefined}
          readOnly={!p?.canManage}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) go()
          }}
        />
        {state ? (
          <span className="pv-card__state">
            <span className={`pv-dot pv-dot--${state.status}`} />
            {PREVIEW_STATE[state.status]}
          </span>
        ) : null}
      </div>
      <div className="wt-mp__stage">
        {p?.awaiting === 'login' ? (
          <div className="wt-mp__login">
            <DevtoolsLogin preview={p} />
            <span>{loginNote(p)}</span>
          </div>
        ) : p?.snapshotAt ? (
          <img className="wt-mp__shot" src={snapshotUrl(p)} alt={`${p.title} 模拟器`} />
        ) : p?.snapshotError ? (
          <EmptyState icon="smartphone" title="没有截到模拟器画面" description={p.snapshotError} />
        ) : p ? (
          <EmptyState icon="smartphone" title="正在截取模拟器画面…" />
        ) : state?.status === 'closed' ? (
          <EmptyState
            icon="smartphone"
            title="预览已关闭"
            action={<Button onClick={() => useWorkbench.getState().closeTab(key)}>关闭标签页</Button>}
          />
        ) : null}
      </div>
    </div>
  )
}

export function useMiniprogramTabMeta(tab: TabProps<'miniprogram'>['tab']): TabMeta {
  const state = usePreview(tab.previewId)
  return {
    icon: 'smartphone',
    title: state?.preview?.title ?? '小程序',
    ...(state ? { status: state.status === 'online' ? 'online' : 'offline' } : {}),
  }
}
