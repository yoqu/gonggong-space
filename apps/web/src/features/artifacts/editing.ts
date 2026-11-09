import { create } from 'zustand'

/**
 * 正在编辑: the artifact a group's composer keeps working on. Every message goes out with it (artifactContext) and,
 * without an @, to its bot, until the member closes it. Kept per group across reloads.
 */
export interface Editing {
  artifactId: string
  title: string
}

const KEY = 'gg.editingArtifacts'

function read(): Record<string, Editing> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Editing>
  } catch {
    return {}
  }
}

export const useEditing = create<{ byGroup: Record<string, Editing>; focus: number }>()(() => ({
  byGroup: read(),
  focus: 0,
}))

/** Starts (or, with null, ends) editing in `groupId`; starting hands the focus to that group's composer. */
export function setEditing(groupId: string, editing: Editing | null) {
  useEditing.setState((s) => {
    const byGroup = { ...s.byGroup }
    if (editing) byGroup[groupId] = editing
    else delete byGroup[groupId]
    try {
      localStorage.setItem(KEY, JSON.stringify(byGroup))
    } catch {
      // Storage can be unavailable: editing then lasts until the page reloads.
    }
    return { byGroup, focus: editing ? s.focus + 1 : s.focus }
  })
}

export const useEditingOf = (groupId: string) => useEditing((s) => (groupId ? s.byGroup[groupId] : undefined))
