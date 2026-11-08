import type { MessageDto } from '@gonggong/protocol'
import { create } from 'zustand'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { hasOpenOverlay, toast } from '../../ui'

/**
 * 从这里标为未读: per group, the message the reader marked unread from. While set, the open chat stops marking
 * read for the rest of the visit and its divider moves there; leaving the group clears it.
 */
export const useUnreadMark = create<{ held: Record<string, string> }>(() => ({ held: {} }))

export const releaseUnreadMark = (groupId: string) =>
  useUnreadMark.setState((s) => {
    if (!(groupId in s.held)) return s
    const { [groupId]: _, ...held } = s.held
    return { held }
  })

export async function markUnreadFrom(m: MessageDto) {
  useUnreadMark.setState((s) => ({ held: { ...s.held, [m.groupId]: m.id } }))
  // Let the chat stop marking first: a read still pending is flushed on that change and must land before this.
  await new Promise((r) => setTimeout(r, 0))
  try {
    await api.put(`/groups/${m.groupId}/unread`, { seq: m.seq })
  } catch {
    releaseUnreadMark(m.groupId)
    toast({ type: 'error', message: t('标为未读失败') })
  }
}

/** Esc / Shift+Esc mark read only when nothing else wants Escape: no overlay, no text being typed. */
export function escFree() {
  if (hasOpenOverlay()) return false
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return !el.value
  return !(el instanceof HTMLElement && el.isContentEditable && el.textContent)
}
