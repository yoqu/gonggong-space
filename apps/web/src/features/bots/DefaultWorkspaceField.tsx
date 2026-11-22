import { useState } from 'react'
import { t } from '../../i18n'
import { Button, FormRow, PathControl, Presence } from '../../ui'
import { DirPicker } from '../workspaces/DirPicker'
import './bots.css'

/** Path as a clickable NSPathControl; a segment reopens the picker at that folder. */
export function WorkspacePath({ path, onPick }: { path: string; onPick: (start: string) => void }) {
  const parts = path.split('/').filter(Boolean)
  const items = parts.map((p, i) => ({
    id: `/${parts.slice(0, i + 1).join('/')}`,
    label: p,
    icon: 'folder' as const,
  }))
  return <PathControl items={items} maxItems={3} onSelect={onPick} aria-label={t('默认工作区路径')} />
}

/** Default workspace row shared by BotDetail and NewBotDialog; keeps DirPicker state local. */
export function DefaultWorkspaceRow({
  machineId,
  value,
  hint,
  pickLabel = t('选择…'),
  onChange,
}: {
  machineId: string
  value: string | null
  hint: string
  pickLabel?: string
  onChange: (path: string | null) => void
}) {
  /** false = closed; otherwise the folder the picker opens at. */
  const [picking, setPicking] = useState<string | null | false>(false)
  return (
    <FormRow label={t('默认工作区')} align="top" hint={hint}>
      <div className="bots-detail__workspace" data-testid="default-workspace" title={value ?? undefined}>
        {value ? (
          <WorkspacePath path={value} onPick={setPicking} />
        ) : (
          <span className="bots-detail__unset">{t('未设置')}</span>
        )}
      </div>
      <div className="bots-detail__buttons">
        <Button size="small" onClick={() => setPicking(value)}>
          {pickLabel}
        </Button>
        {value ? (
          <Button size="small" onClick={() => onChange(null)}>
            {t('清除')}
          </Button>
        ) : null}
      </div>
      <Presence>
        {picking !== false ? (
          <DirPicker
            machineId={machineId}
            title={t('默认工作区')}
            start={picking}
            onPick={(path) => {
              onChange(path)
              setPicking(false)
            }}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </Presence>
    </FormRow>
  )
}
