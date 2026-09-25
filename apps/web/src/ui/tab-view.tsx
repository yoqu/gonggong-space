import { type ReactNode, useState } from 'react'
import { Tabs } from './segmented'
import './tab-view.css'

export interface TabViewProps {
  /** 2–6 tabs with noun labels. */
  tabs: { value: string; label: ReactNode; content: ReactNode }[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
}

/** Pane TabView: a centered tab control sitting on the top edge of a group box. */
export function TabView({ tabs, value, defaultValue, onChange }: TabViewProps) {
  const [own, setOwn] = useState(defaultValue ?? tabs[0]?.value ?? '')
  const current = value ?? own
  return (
    <div className="ui-tab-view">
      <div className="ui-tab-view__bar">
        <Tabs
          items={tabs.map((t) => ({ value: t.value, label: t.label }))}
          value={current}
          onChange={(v) => {
            setOwn(v)
            onChange?.(v)
          }}
        />
      </div>
      <div className="ui-tab-view__panel" role="tabpanel">
        {tabs.find((t) => t.value === current)?.content}
      </div>
    </div>
  )
}
