/**
 * The page's connection to its host: installs `window.openartifact` (unless
 * a host already did) and resolves the capabilities the editor uses.
 */

import type { AgentCapability, ArtifactCapability, AssetsCapability, CommentsCapability, DownloadsCapability, RoomCapability, ShellConnection, Viewer } from '@open-artifact/runtime';
import { connectHost, sessionSlot } from '@open-artifact/editor-kit';

export { artifactPath, projectPath } from '@open-artifact/editor-kit';

/** Everything the editor talks to. Missing capabilities are `null`. */
export interface Session {
  artifact: ArtifactCapability;
  assets: AssetsCapability | null;
  agent: AgentCapability | null;
  room: RoomCapability | null;
  downloads: DownloadsCapability | null;
  comments: CommentsCapability | null;
  viewer: Viewer;
  canEdit: boolean;
  /** The Open Artifact Shell framing this page, if any. */
  shell: ShellConnection | null;
}

const slot = sessionSlot<Session>();

/** The session; throws before {@link startSession} resolved. */
export const session = slot.session;

/** The session, or null before it started (for code that may run early). */
export const maybeSession = slot.maybeSession;

/** Connects to the host. Rejects when the artifact capability is unavailable. */
export async function startSession(): Promise<Session> {
  const { caps, viewer, abilities, shell } = await connectHost(['artifact', 'assets', 'agent', 'room', 'downloads', 'comments']);
  const { artifact, assets, agent, room, downloads, comments } = caps;
  if (!artifact) throw new Error('This page could not reach its artifact. Open it again from your agent.');
  return slot.set({ artifact, assets, agent, room, downloads, comments, viewer, canEdit: abilities.canEdit, shell });
}

/**
 * Turns an asset reference into a URL the page can load: uploads are served
 * at the origin root, design-system files beside the editor page.
 */
export function resolveSrc(src: string): string {
  if (src.startsWith('/_blob/') || /^(data|blob|https?):/i.test(src)) return src;
  if (src.startsWith('project/')) return new URL(src, document.baseURI).href;
  return src;
}
