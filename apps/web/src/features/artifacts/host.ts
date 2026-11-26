import { createContext, useContext } from 'react'
import { useWorkbench } from '../../app/workbench'

/**
 * Set by a page that hosts an artifact on its own (作品 `/works/:id`) rather than as a workbench tab: what deleting
 * it leaves to, and moving it stays on the page instead of following it into the target group's chat.
 */
export interface ArtifactPageHost {
  leave: () => void
  /** Back to works list when hosted on /works/:id (renders inside the artifact toolbar). */
  back?: () => void
  /** Opens the send-to-group dialog when hosted on /works/:id. */
  onShareToGroup?: () => void
  groupKind?: 'group' | 'dm' | 'works'
}

export const ArtifactPage = createContext<ArtifactPageHost | null>(null)

export const useArtifactPage = () => useContext(ArtifactPage)

/** Leaves a deleted artifact: back to its page's list, or closes its workbench tab. */
export function useLeaveArtifact(tabKey: string) {
  const page = useArtifactPage()
  return page ? page.leave : () => useWorkbench.getState().closeTab(tabKey)
}
