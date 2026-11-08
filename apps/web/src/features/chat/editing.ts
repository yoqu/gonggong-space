import { type MessageDto, RECALL_WINDOW_MS } from '@gonggong/protocol'
import { create } from 'zustand'

/** The message whose inline editor is open (one at a time), and where the focus returns once it closes. */
export const useEditing = create<{ id: string | null; back: HTMLElement | null }>(() => ({
  id: null,
  back: null,
}))

export const startEditing = (id: string, back: HTMLElement | null = null) => useEditing.setState({ id, back })

export function stopEditing() {
  const { back } = useEditing.getState()
  useEditing.setState({ id: null, back: null })
  back?.focus()
}

/** My own text within the recall window; commands are not editable (the server refuses them too). */
export const canEdit = (m: MessageDto, now = Date.now()) =>
  !!m.body && !m.body.trimStart().startsWith('/') && now - Date.parse(m.createdAt) < RECALL_WINDOW_MS

/** ↑ in an empty composer (Slack): my latest message, when it may still be edited. */
export function lastEditable(messages: MessageDto[], me: string | undefined) {
  const m = messages.findLast((x) => x.kind === 'user' && x.authorId === me && !x.recalled && !x.hidden)
  return m && m.card?.type !== 'creation' && canEdit(m) ? m : undefined
}
