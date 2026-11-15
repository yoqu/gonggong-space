import { uuid } from './MessageComposer'
import { postMessage } from './pending'

/** Same as typing `/new @bot`: its next turn starts a fresh session; in a thread, only the thread's session. */
export const startNewSession = (groupId: string, botName: string, threadRootId?: string) =>
  postMessage(groupId, {
    body: `/new @${botName}`,
    clientId: uuid(),
    attachmentIds: [],
    quote: null,
    appendTo: null,
    ...(threadRootId && { threadRootId }),
  })
