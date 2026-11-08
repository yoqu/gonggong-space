import { useInspector } from '../../app/inspector'

/** Opens the thread of `rootId` in the chat's right rail (plan 话题); `fromList`: its header leads back to the list. */
export const openThread = (rootId: string, fromList = false) =>
  useInspector.getState().open('thread', rootId, fromList ? 'threads' : undefined)
