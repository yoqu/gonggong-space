/**
 * The page's connection to its host (`window.openartifact`). Only `db` is required: the film lives in the store.
 * Without `agent`, `comments`, `room`, `assets` or `downloads` the matching features are hidden. Shown inline
 * (`display-mode.ts`), the page runs on a view-only host (`view-only.ts`): the store read live, nothing else.
 */

import {
  createPageProvider,
  installRuntime,
  type AgentCapability,
  type AssetsCapability,
  type CommentsCapability,
  type DbCapability,
  type DownloadsCapability,
  type RoomCapability,
  type ShellConnection,
  type Viewer,
} from '@open-artifact/runtime';
import { connectHost, sessionSlot, type RoleAbilities } from '@open-artifact/editor-kit';
import { isInlineDisplay } from './display-mode.ts';
import { viewOnlyProvider } from './view-only.ts';
import { STORE_UNREACHABLE } from './words.ts';

export interface Session extends RoleAbilities {
  /** Shown inline (`#view-inline` in a frame): read-only, whatever the viewer's role. */
  inline: boolean;
  db: DbCapability;
  comments: CommentsCapability | null;
  assets: AssetsCapability | null;
  agent: AgentCapability | null;
  room: RoomCapability | null;
  downloads: DownloadsCapability | null;
  viewer: Viewer;
  peerId: string;
  shell: ShellConnection | null;
}

const slot = sessionSlot<Session>();

/** The session; throws before {@link startSession} resolved. */
export const session = slot.session;

/** The session, or `null` before it started (or when the store could not be reached). */
export const maybeSession = slot.maybeSession;

/** Connects to the host. Rejects when the document store is unavailable. */
export async function startSession(): Promise<Session> {
  const inline = isInlineDisplay();
  // Before connectHost installs the full one: the first runtime installed is the page's.
  if (inline) installRuntime(viewOnlyProvider(createPageProvider()));
  const { caps, viewer, abilities, shell } = await connectHost(['db', 'comments', 'assets', 'agent', 'room', 'downloads']);
  const { db, comments, assets, agent, room, downloads } = caps;
  if (!db) throw new Error(STORE_UNREACHABLE);
  const peerId = (await room?.self().catch(() => null)) ?? viewer.id;
  return slot.set({ inline, db, comments, assets, agent, room, downloads: abilities.canSaveToHost ? downloads : null, viewer, peerId, ...abilities, shell });
}
