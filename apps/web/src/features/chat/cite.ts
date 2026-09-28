import { create } from 'zustand'

/** Text another pane hands to a group's composer, e.g. 在聊天中引用 a workspace file as `@path`. */
export const useCite = create<{ pending: { groupId: string; text: string } | null }>(() => ({
  pending: null,
}))

export const citeInChat = (groupId: string, text: string) => useCite.setState({ pending: { groupId, text } })
