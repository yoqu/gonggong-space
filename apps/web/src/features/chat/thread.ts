import { useInspector } from '../../app/inspector'

/** Opens the thread of `rootId` in the chat's right rail (plan 话题). */
export const openThread = (rootId: string) => useInspector.getState().open('thread', rootId)
