/**
 * What each role may do in an artifact, the way the host's sharing rules
 * allow it, so an editor only offers what the server will accept:
 *
 * - owner: everything, including sending requests to the agent, saving
 *   files to the computer that shares the artifact and calling its
 *   connectors (`mcp`);
 * - editor (a guest who may edit): changes the artifact, removes comments
 *   and restores versions, but cannot reach the owner's agent or downloads;
 * - commenter: comments (add, reply, resolve, move) on a read-only artifact;
 * - viewer: reads only.
 *
 * Pure.
 */

import type { Role } from '@open-artifact/runtime';

/** What a viewer may do. */
export interface RoleAbilities {
  /** Change the artifact (owner or editor). */
  canEdit: boolean;
  /** Add, reply to, resolve and move comments (anyone but a plain viewer). */
  canComment: boolean;
  /** Delete comment threads (owner or editor). */
  canRemoveComments: boolean;
  /** Restore a past version (owner or editor). */
  canRestore: boolean;
  /** Send requests to the agent: Ask, "Send to agent" on a comment (the owner alone). */
  canAsk: boolean;
  /**
   * Save files through the host's downloads, on the sharing computer (the owner alone; guests get a browser download).
   * Every role on a host whose downloads save in the browser (see `hostAbilities`).
   */
  canSaveToHost: boolean;
  /** Call the connectors (MCP servers) set up on the sharing computer (the owner alone). */
  canUseConnectors: boolean;
}

/** The abilities of a role. An unknown role reads only. */
export function roleAbilities(role: Role | string): RoleAbilities {
  const owner = role === 'owner';
  const edits = owner || role === 'editor';
  const comments = edits || role === 'commenter';
  return { canEdit: edits, canComment: comments, canRemoveComments: edits, canRestore: edits, canAsk: owner, canSaveToHost: owner, canUseConnectors: owner };
}

/** How the chrome names a read-only role (`null`: the viewer can edit). */
export function readOnlyLabel(role: Role | string): string | null {
  if (roleAbilities(role).canEdit) return null;
  return role === 'commenter' ? 'Comment only' : 'View only';
}
