/**
 * Identifiers: artifact and type URLs, artifact ids and Session Refs.
 *
 * These helpers are pure (no Node or DOM APIs) so the daemon, harness
 * adapters, the Shell and pages can all share them.
 */

/** Protocol version spoken by daemons, adapters and type servers. */
export const OPEN_ARTIFACT_PROTOCOL = 1;

/** An artifact id: `art_` + base36 time + random hex. */
export const ARTIFACT_ID = /^art_[0-9a-z]{10,40}$/;

/** A type id: the type folder's name. */
export const TYPE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** A harness name, as an adapter says it in `hello`. */
export const HARNESS_NAME = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

/** `open-artifact://artifact/<id>`: how agents and tools name an artifact. */
export type ArtifactUrl = `open-artifact://artifact/${string}`;

/** `open-artifact://type/<id>`: how agents and tools name a type. */
export type TypeUrl = `open-artifact://type/${string}`;

/** The URL of an artifact id. */
export function artifactUrl(id: string): ArtifactUrl {
  return `open-artifact://artifact/${id}`;
}

/** The URL of a type id. */
export function typeUrl(id: string): TypeUrl {
  return `open-artifact://type/${id}`;
}

/** `open-artifact://artifact/<id>` or a bare id → the id, or `null` when it is neither. */
export function artifactIdOf(urlOrId: unknown): string | null {
  if (typeof urlOrId !== 'string') return null;
  const match = /^open-artifact:\/\/artifact\/([^/?#]+)/.exec(urlOrId.trim());
  const id = match ? match[1]! : urlOrId.trim();
  return ARTIFACT_ID.test(id) ? id : null;
}

/** `open-artifact://type/<id>` or a bare id → the id, or `null` when it is neither. */
export function typeIdOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const match = /^open-artifact:\/\/type\/([^/?#]+)/.exec(url.trim());
  if (match) return match[1]!;
  return TYPE_ID.test(url.trim()) ? url.trim() : null;
}

/**
 * A Session Ref: which agent session made or owns an artifact.
 *
 * `session` is the harness's own session id; `workspace` is the session's
 * working folder. At least one of them is set for a usable ref.
 */
export interface SessionRef {
  /** The harness name (`dsh`, `codex`, `mcp`…). */
  harness: string;
  /** The harness's session id, when known. */
  session: string | null;
  /** The session's working folder (absolute), when known. */
  workspace: string | null;
}

/**
 * The string form of a {@link SessionRef}, as inbox file names and the
 * daemon's session map use it:
 *
 * - `<harness>:<session>` when the session id is known;
 * - `<harness>:ws:<hash>` when only the workspace is known, where `hash` is
 *   the first 12 hex digits of the SHA-1 of the resolved workspace path.
 *
 * Hashing needs a platform API, so the caller passes it in.
 */
export function sessionKey(
  ref: Partial<SessionRef> | null | undefined,
  hashWorkspace: (workspace: string) => string,
): string | null {
  if (!ref) return null;
  if (ref.session) return `${ref.harness ?? 'unknown'}:${ref.session}`;
  if (ref.workspace) return `${ref.harness ?? 'unknown'}:ws:${hashWorkspace(ref.workspace)}`;
  return null;
}
