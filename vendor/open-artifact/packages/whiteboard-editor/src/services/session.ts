/**
 * The page's connection to its host: installs `window.openartifact` (unless
 * a host already did) and resolves every capability the board uses.
 *
 * Only `db` is required: a board is its document store. Everything else is
 * optional and its absence turns the matching feature off (no `comments`: no
 * comment mode; no `agent`: Ask is hidden; no `room`: no live cursors; no
 * `history`: no version history). What the viewer may do follows their role
 * (`roleAbilities`, `@open-artifact/editor-kit`): guests never get the owner's agent or host downloads.
 */

import type {
  AgentCapability,
  AssetsCapability,
  CommentsCapability,
  DbCapability,
  DownloadsCapability,
  HistoryCapability,
  RoomCapability,
  ShellConnection,
  Viewer,
} from '@open-artifact/runtime';
import { connectHost, sessionSlot, type RoleAbilities } from '@open-artifact/editor-kit';

/** Everything the board talks to. Missing capabilities are `null`. */
export interface Session extends RoleAbilities {
  db: DbCapability;
  comments: CommentsCapability | null;
  assets: AssetsCapability | null;
  agent: AgentCapability | null;
  room: RoomCapability | null;
  /** Saving files to the sharing computer: the owner's alone (`null` for guests, who get browser downloads). */
  downloads: DownloadsCapability | null;
  /** The board's version history, when the host keeps one. */
  history: HistoryCapability | null;
  viewer: Viewer;
  /** This page's own peer id (`viewer.id` when there is no room). */
  peerId: string;
  /** The Open Artifact Shell framing this page, if any. */
  shell: ShellConnection | null;
}

const slot = sessionSlot<Session>();

/** The session; throws before {@link startSession} resolved. */
export const session = slot.session;

/** The session, or `null` before it started (for code that may run early). */
export const maybeSession = slot.maybeSession;

/** Connects to the host. Rejects when the document store is unavailable. */
export async function startSession(): Promise<Session> {
  const { caps, viewer, abilities, shell } = await connectHost(['db', 'comments', 'assets', 'agent', 'room', 'downloads', 'history']);
  const { db, comments, assets, agent, room, downloads, history } = caps;
  if (!db) throw new Error('This page could not reach its board. Open it again from your agent.');
  const peerId = (await room?.self().catch(() => null)) ?? viewer.id;
  return slot.set({ db, comments, assets, agent, room, downloads: abilities.canSaveToHost ? downloads : null, history, viewer, peerId, ...abilities, shell });
}
