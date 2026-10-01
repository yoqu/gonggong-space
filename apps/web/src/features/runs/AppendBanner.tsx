import { Button, Icon } from '../../ui'
import { useAppend } from './append'
import './question.css'
import { t } from '../../i18n'

/** Composer strip while the next message will be 打断并追加 into a running run. */
export function AppendBanner({ groupId }: { groupId: string }) {
  const target = useAppend((s) => (s.target?.groupId === groupId ? s.target : null))
  const clear = useAppend((s) => s.clear)
  if (!target) return null
  return (
    <div className="append-banner">
      <Icon name="arrow-turn-down-right" size={14} />
      <span>{t('打断并追加到 {name} · 已改内容保留，仍算同一轮', { name: target.botName })}</span>
      <Button variant="plain" size="small" onClick={clear}>
        {t('关闭#close')}
      </Button>
    </div>
  )
}
