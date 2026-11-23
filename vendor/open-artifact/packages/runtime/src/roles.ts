/**
 * What each role may do on an artifact's page routes.
 *
 * The local type server (`@open-artifact/type-server`'s `sharing.ts`) and a
 * cloud host both decide with this table, so a role means the same thing
 * wherever the page is served. Reads (`GET`) are everyone's; the table is
 * about write calls.
 *
 * Pure: no Node or DOM APIs.
 */

import type { Role } from './capabilities.ts';
import { DOC_API } from './doc-api.ts';
import { API } from './http-api.ts';
import { SHEET_API } from './sheet-api.ts';

/** Page routes a commenter may write: the comment threads (not sending them to the agent). */
export const COMMENT_WRITES: ReadonlySet<string> = new Set<string>([API.commentsCreate, API.commentsReply, API.commentsEdit, API.commentsReact, API.commentsResolve, API.commentsMove]);
/** Page routes that change the artifact. */
export const EDIT_WRITES: ReadonlySet<string> = new Set<string>([API.publish, API.assets, API.dbWrite, API.commentsRemove, API.roomEmit, API.historyRestore, API.historyDismiss, DOC_API.restore, DOC_API.importFile, SHEET_API.send]);
/** Page routes that answer with a POST: everyone's, as reads are (a Sheet's widget refuses a write by role itself). */
export const POSTED_READS: ReadonlySet<string> = new Set<string>([SHEET_API.read, SHEET_API.widget, DOC_API.session, DOC_API.read, DOC_API.history, DOC_API.version, DOC_API.call]);
/** Page routes that act on this computer or reach the agent: the owner's alone. */
export const OWNER_WRITES: ReadonlySet<string> = new Set<string>([API.agentSend, API.commentsSend, API.downloads, API.mcpCall, API.dataRefresh, SHEET_API.importFile]);

/** What a type lets roles do beyond the table above. */
export interface RoleOptions {
  /**
   * A commenter may write some store documents of their own (the type's `commenterWrites`): the store's write route
   * lets them through, and the store checks each path.
   */
  commenterWrites?: boolean;
  /**
   * An editor may send to the owner's agent ({@link ASK_AGENT_ROUTES}): a hosted artifact whose owner lets editors
   * ask. Never a commenter or a viewer. Off by default, and never set on this computer.
   */
  editorsAskAgent?: boolean;
}

/**
 * The owner's routes that send to their agent (or, for a dashboard's live-data refresh, to their linked computer): an
 * editor's too when {@link RoleOptions.editorsAskAgent}.
 */
export const ASK_AGENT_ROUTES: ReadonlySet<string> = new Set<string>([API.agentSend, API.commentsSend, API.dataRefresh]);

/** Whether the role may make a write call to a page route (reads are everyone's). */
export function roleMay(role: Role, route: string, options: RoleOptions = {}): boolean {
  if (role === 'owner') return true;
  if (route === API.presence || POSTED_READS.has(route)) return true;
  if (OWNER_WRITES.has(route)) return role === 'editor' && options.editorsAskAgent === true && ASK_AGENT_ROUTES.has(route);
  if (COMMENT_WRITES.has(route)) return role !== 'viewer';
  if (route === API.dbWrite && role === 'commenter' && options.commenterWrites === true) return true;
  if (EDIT_WRITES.has(route)) return role === 'editor';
  // A route this list does not know: the owner's, to be safe.
  return false;
}

/** Whether a page route is the owner's alone, whatever the other roles are (for the message that refuses it). */
export function isOwnerOnlyRoute(route: string): boolean {
  return OWNER_WRITES.has(route);
}
