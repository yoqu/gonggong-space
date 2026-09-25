import { Button, Icon } from '../../ui'
import { useAppend } from './append'
import './question.css'

/** Composer strip while the next message will be 打断并追加 into a running run. */
export function AppendBanner({ groupId }: { groupId: string }) {
  const target = useAppend((s) => (s.target?.groupId === groupId ? s.target : null))
  const clear = useAppend((s) => s.clear)
  if (!target) return null
  return (
    <div className="append-banner">
      <Icon name="arrow-turn-down-right" size={14} />
      <span>打断并追加到 {target.botName} · 已改内容保留，仍算同一轮</span>
      <Button variant="plain" size="small" onClick={clear}>
        关闭
      </Button>
    </div>
  )
}
