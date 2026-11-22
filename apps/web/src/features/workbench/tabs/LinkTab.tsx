import { useState } from 'react'
import { t } from '../../../i18n'
import { Button, Icon } from '../../../ui'
import type { TabMeta, TabProps } from '../types'
import './web-tab.css'

/** A third-party page pinned in the group's tab bar; it can't read our cookies (other origin, sandboxed). */
export function LinkTab({ tab }: TabProps<'link'>) {
  const [reload, setReload] = useState(0)
  // Our own origin unsandboxed would reach the app's session: keep it in an opaque origin.
  let ours = true
  try {
    ours = new URL(tab.url, location.href).origin === location.origin
  } catch {
    // Malformed URL stays maximally sandboxed instead of crashing the workbench.
  }
  return (
    <div className="wt-web">
      <div className="wt-web__bar">
        <Button
          size="small"
          variant="plain"
          icon="arrow-clockwise"
          aria-label={t('刷新')}
          onClick={() => setReload((n) => n + 1)}
        />
        <span className="wt-web__url" title={tab.url}>
          {tab.url}
        </span>
        <a
          className="ui-btn ui-btn--small ui-btn--plain ui-btn--icon"
          href={tab.url}
          target="_blank"
          rel="noreferrer"
          aria-label={t('新窗口打开')}
          title={t('新窗口打开')}
        >
          <Icon name="external" size={14} />
        </a>
      </div>
      <div className="wt-web__stage">
        <iframe
          key={reload}
          className="wt-web__frame"
          title={tab.title}
          src={tab.url}
          referrerPolicy="no-referrer"
          sandbox={`allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads${ours ? '' : ' allow-same-origin'}`}
        />
      </div>
    </div>
  )
}

export function useLinkTabMeta(tab: TabProps<'link'>['tab']): TabMeta {
  return { icon: 'globe', title: tab.title }
}
