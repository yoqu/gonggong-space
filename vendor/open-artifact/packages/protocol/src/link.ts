/**
 * The Link API: how a local daemon keeps artifacts in step with a cloud host
 * (`/api/open-artifact.link.*` on the host's app origin).
 *
 * Signing in (a device flow, as in RFC 8628):
 *
 * 1. The daemon posts {@link LinkDeviceRequest} to `link.device` and shows the
 *    person {@link LinkDeviceStart}'s `verification_uri_complete`.
 * 2. It polls `link.token` with the `device_code` every `interval` seconds; the
 *    host answers {@link LinkTokenError} (`authorization_pending`, `slow_down`)
 *    until the person approves, then {@link LinkToken}.
 * 3. Every other route carries `Authorization: Bearer <access_token>`; before
 *    it runs out the daemon trades the `refresh_token` at `link.token` again.
 *
 * Sync is manifest based: the daemon keeps the etag of every file at its last
 * sync (`ArtifactRecord.remote.base`), reads `link.manifest`, and pushes with
 * `link.files` (`if_match` = the base etag). A refused push (`conflict`) means a
 * person changed the file on the host. `link.events` is a server-sent-event
 * stream: each event's `id:` is {@link LinkEvent}'s `id` and its `data:` the
 * event as JSON; the daemon acknowledges what it handled with `link.ack`, and
 * the host sends unacknowledged events again after `?after=`.
 *
 * In this version Link reaches only the artifacts the signed-in person owns.
 *
 * As the host answers (settled with the first host implementation):
 *
 * - Every route but `device` and `token` takes the Bearer token only (a session cookie does not count). A missing,
 *   expired, revoked or unknown token is 401 with `WWW-Authenticate`; a token without the `link` scope is 403
 *   `not_granted`. Another person's artifact, a trashed one and an unknown id are all 404 `not_found`.
 * - `link.events` sends the unacknowledged events with an id above `?after=` (or the `Last-Event-ID` header when
 *   `after` is left out), then each new one live. Without `after` every unacknowledged event is sent again: that is
 *   the redelivery. Every open stream of the person gets every event (two computers each hear it), and the person's
 *   agent counts as online while at least one stream is open. Frames are `id: <n>` + `data: <json>`; comment lines
 *   (`: hello`, `: ping` about every 25 s) keep the stream open and carry nothing.
 * - Changes the Link made itself (`link.files` pushes, `link.import`, `link.unpublish`, `db` writes through
 *   `link.call`) are not sent back on `link.events`. So a daemon that forwards a write with `link.call` syncs once
 *   the call is answered, to bring the result home (it is the agent's own change, not a person's edit).
 *
 * Settled when the two halves first met (the integration step):
 *
 * - Which paths a sync carries: {@link linkSynced}. `link.manifest` lists every archive path, but `.artifact.json` (each
 *   folder's own marker, rewritten on import) and `history/` (each server's own version history, written by whichever
 *   server watched the change) never travel: a daemon neither pushes nor pulls them, and `link.files` refuses them.
 * - A `link.files` POST is checked as a whole first: one refused path fails the request with 400 `invalid_argument`
 *   and nothing is written, so a daemon only sends paths {@link linkSynced} allows (and never `doc/` or `sheet/`).
 * - A person's edit is what a `files` event names. Files a sync pulls without such an event (`comments.json` after a
 *   reply, a `db` document after the agent's own `link.call` write) are not counted as a person's edit.
 * - `wake` events carry `requests` the way a page's wake does: a comment a person sends to the agent from a page is a
 *   request whose `selection` holds the thread (the daemon writes the usual request text from it).
 * - What a `link.call` action writes on the host is not sent back as a `files` event (it is the Link's own change), so
 *   a daemon syncs right after a write action to bring it home. A `files` event whose `author` starts with `agent` is
 *   the agent's own change too; any other author is a person.
 * - A `link.files` POST answers the artifact's new `title` when the writes changed the file its type reads the title
 *   from; the daemon takes it over the manifest it read before pushing.
 * - Every Link route takes a body up to `hello.limits.maxBodyBytes` (the host's general body cap does not apply).
 *
 * Live data of a published Data dashboard (added with the snapshot; additive):
 *
 * - Connectors run only on the owner's computer, so a hosted page cannot call one. The owner's linked daemon runs the
 *   dashboard's live queries there and keeps their answers as saved rows (`db/data/live.json` and
 *   `db/data/live/answers/<dataset>.json`), which reach the host the way every other working-copy file does
 *   (`link.files`). Pages on the host replay them: "Data as of <time>, from <owner>'s computer".
 * - The daemon refreshes a published dashboard when it is published, when someone asks ({@link LinkDataRefreshEvent}),
 *   and on a timer while it is linked (`settings.cloud.dataRefresh`, minutes; `0` never). It never refreshes an
 *   unpublished artifact, nor one whose owner has not confirmed that its data is published with it
 *   (`ArtifactRecord.dataPublish`). A failed refresh keeps the last answers and records why in `data/live`.
 * - A page asks for a refresh with `POST _api/data/refresh` on its type server (the owner always; an editor only when
 *   the owner lets editors ask the agent, `editorsCanAskAgent`; never a commenter or viewer). The host does not call a
 *   connector: it adds a `data-refresh` event to the owner's outbox, like a wake, and the daemon honours it once when it
 *   is next online. The event goes through the same outbox on every host.
 */

import { archiveIncludes } from './archive-paths.ts';
import { ARTIFACT_ID } from './refs.ts';
import type { ArtifactRole } from './type-server.ts';
import type { WakeRequestItem, WakeThread } from './wake.ts';

/** What every Link route's path starts with. */
export const LINK_API_PREFIX = '/api/open-artifact.link.';

/** Link API route names, after {@link LINK_API_PREFIX}. */
export const LINK_ROUTES = {
  /** `POST` {@link LinkDeviceRequest} → {@link LinkDeviceStart}. No bearer. */
  device: 'device',
  /** `POST` {@link LinkTokenRequest} → {@link LinkToken}, or 400 with {@link LinkTokenError}. No bearer. */
  token: 'token',
  /** `GET` → {@link LinkHello}. */
  hello: 'hello',
  /**
   * `GET` → {@link LinkArtifactsResult}: the person's own artifacts, without their files (one catalog read however
   * many there are). `GET ?files=1` adds each one's `files` (a manifest per artifact: slow for a long list; prefer
   * `manifest` for the one you need).
   */
  artifacts: 'artifacts',
  /**
   * `POST` a zip (`application/zip`) with query `id`, `type`, `title` → 201 {@link LinkArtifact}. `id` must be a valid
   * artifact id not in use on the host (else 409 `conflict`). The type is read from the archive (`type` is not
   * trusted over it); `title`, when given, wins over the title read from the archive.
   */
  import: 'import',
  /** `GET ?id=` → the artifact's folder as a zip. */
  export: 'export',
  /** `GET ?id=` → {@link LinkManifest}. */
  manifest: 'manifest',
  /**
   * `GET ?id=&path=` → the file's bytes with an `ETag` header (the {@link LinkFile} etag in double quotes, as HTTP
   * writes it); `POST` {@link LinkFilesRequest} → {@link LinkFilesResult}.
   */
  files: 'files',
  /** `GET ?after=<event id>` → a server-sent-event stream of {@link LinkEvent}. */
  events: 'events',
  /** `POST` {@link LinkAckRequest} → `{}`. */
  ack: 'ack',
  /**
   * `POST` {@link LinkCallRequest} → the action's result. Actions that need the host's own disk or Chrome (`upload`,
   * `snapshot`, `share`, Docs `duplicate` and `import`) are refused with 400 `unsupported`: run them on the working
   * copy. Any other name goes to the type server, which answers an unknown one itself.
   */
  call: 'call',
  /** `POST` {@link LinkUnpublishRequest} → `{}`. */
  unpublish: 'unpublish',
} as const;

/** A Link route name. */
export type LinkRoute = (typeof LINK_ROUTES)[keyof typeof LINK_ROUTES];

/** The person a Link token acts for. */
export interface LinkUser {
  id: string;
  name: string;
  email?: string;
}

/** `POST link.device`: which client asks to be linked (shown to the person who approves). */
export interface LinkDeviceRequest {
  client: { name: string; harness?: string; version?: string };
}

/** `POST link.device` answer. */
export interface LinkDeviceStart {
  /** Secret the daemon polls `link.token` with. */
  device_code: string;
  /** Short code the person checks on the approval page. */
  user_code: string;
  /** The approval page. */
  verification_uri: string;
  /** The approval page with the code filled in. */
  verification_uri_complete: string;
  /** Seconds until the codes run out. */
  expires_in: number;
  /** Seconds to wait between polls. */
  interval: number;
}

/** `POST link.token`: finish the device flow, or trade a refresh token for a new access token. */
export type LinkTokenRequest = { grant_type: 'device_code'; device_code: string } | { grant_type: 'refresh_token'; refresh_token: string };

/** `POST link.token` answer. */
export interface LinkToken {
  access_token: string;
  /** Trades for a new pair at `link.token`; the old refresh token stops working. */
  refresh_token: string;
  /** Seconds the access token lasts. */
  expires_in: number;
  user: LinkUser;
}

/**
 * `POST link.token` refused (HTTP 400): `authorization_pending` (not approved yet, poll again), `slow_down` (poll
 * less often), `expired_token` (the device code, or the refresh token, is no longer good: sign in again),
 * `access_denied` (the person refused).
 *
 * An unknown or already used device code is `expired_token` too. A request that is not a token request at all (no
 * `grant_type`, a missing code) is the flat `invalid_argument` error, not this. Access tokens last an hour; a refresh
 * token lasts 90 days from its last use, and using a spent refresh token again revokes the whole sign-in.
 */
export interface LinkTokenError {
  error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied';
  error_description?: string;
}

/** `GET link.hello` answer. */
export interface LinkHello {
  openArtifact: 1;
  /** The host's version. */
  version: string;
  user: LinkUser;
  limits: {
    /** Largest request body the host takes, bytes. */
    maxBodyBytes: number;
    /** Largest single file the host takes, bytes. */
    maxFileBytes: number;
  };
}

/** One file as the host has it. */
export interface LinkFile {
  /** SHA-256 of the bytes, hex. */
  etag: string;
  size: number;
}

/** An artifact on the host, with its files. */
export interface LinkArtifact {
  id: string;
  /** Its address on the host (`<host>/a/<id>`). */
  url: string;
  type: string;
  title: string;
  /** Path → file, the same paths the host's `link.manifest` lists. */
  files: Record<string, LinkFile>;
}

/** One artifact in {@link LinkArtifactsResult}: a {@link LinkArtifact} whose `files` come only with `?files=1`. */
export type LinkArtifactSummary = Omit<LinkArtifact, 'files'> & { files?: Record<string, LinkFile> };

/** `GET link.artifacts` answer. */
export interface LinkArtifactsResult {
  artifacts: LinkArtifactSummary[];
}

/**
 * `GET link.manifest?id=` answer: every file of the artifact, the same paths an export zip holds (no `_agent/`, no
 * dot files but `.artifact.json` and the few the server keeps).
 */
export interface LinkManifest {
  id: string;
  title: string;
  files: Record<string, LinkFile>;
}

/** One write in {@link LinkFilesRequest}. */
export interface LinkWrite {
  /** Path in the artifact folder, `/`-separated. Paths under `doc/` and `sheet/` are refused: the server writes them. */
  path: string;
  /** The new bytes as base64, or `null` to delete the file. */
  content: string | null;
  /** The etag the file must still have (`null`: it must not exist); omitted, the write goes through whatever is there. */
  if_match?: string | null;
}

/** What became of one {@link LinkWrite}: written (or deleted, `etag: null`), or refused because the file changed. */
export type LinkWriteResult = { path: string; etag: string | null } | { path: string; conflict: true; etag: string | null };

/** `POST link.files`. */
export interface LinkFilesRequest {
  id: string;
  writes: LinkWrite[];
}

/** `POST link.files` answer, in the order of the writes. */
export interface LinkFilesResult {
  results: LinkWriteResult[];
  /** The artifact's title, when the writes changed it. */
  title?: string;
}

/** `POST link.call`: run an artifact action on the host (Docs and Sheet actions, comments, the db, view context). */
export interface LinkCallRequest {
  id: string;
  action: string;
  /** An object (or left out / null for `{}`); anything else is 400 `invalid_argument`. */
  args: unknown;
}

/** One event on `link.events`. */
export type LinkEvent =
  /** People sent comments or requests to the owner's agent. */
  | { id: string; type: 'wake'; artifact: string; threads?: WakeThread[]; requests?: Array<Omit<WakeRequestItem, 'id'> & { id?: string }>; from?: { name: string; role: ArtifactRole } }
  /** Files changed on the host by a person through a page (`author` is who changed them; never the Link itself). */
  | { id: string; type: 'files'; artifact: string; author: string; paths: string[]; title?: string }
  /** An artifact was renamed, or removed from the host. */
  | { id: string; type: 'artifact'; artifact: string; title?: string; removed?: boolean }
  /** Someone asked for the dashboard's live data to be run again on the owner's computer. */
  | LinkDataRefreshEvent;

/**
 * Someone asked from a page on the host for a published dashboard's live data to be refreshed: the owner's daemon runs
 * the queries (`queries`, the dataset ids; all of them when left out) on the owner's computer and pushes the answers.
 * `from` is who asked when it was not the owner (an editor the owner lets ask the agent). Kept in the outbox until a
 * daemon acknowledges it, like a wake, so a request made while no daemon is online waits for one.
 */
export interface LinkDataRefreshEvent {
  id: string;
  type: 'data-refresh';
  artifact: string;
  queries?: string[];
  from?: { name: string; role: ArtifactRole };
}

/** The outbox kind of a {@link LinkDataRefreshEvent} (a host's own row kind, as `wake` is for wakes). */
export const DATA_REFRESH_EVENT = 'data-refresh';

/**
 * The type server's reserved action a daemon calls to take a dashboard's live-data snapshot on this computer (never
 * offered to an agent, which cannot call `open-artifact.*` names): `{owner, queries?, clear?}` → {@link DataRefreshResult}.
 */
export const DATA_REFRESH_ACTION = 'open-artifact.data.refresh';

/** {@link DATA_REFRESH_ACTION}'s answer. */
export interface DataRefreshResult {
  /** When the answers were taken (ISO). */
  at: string;
  /** Dataset ids whose answers were refreshed. */
  refreshed: string[];
  /** Dataset ids that failed, with why (their last answers are kept). */
  failed: Array<{ id: string; reason: string }>;
  /** Dataset ids kept on this computer (`"snapshot": false`) or skipped. */
  skipped?: string[];
  /** `clear`: the snapshot was removed. */
  cleared?: boolean;
}

/** `POST link.ack`: the events the daemon has handled (ids that are not the person's are left alone). */
export interface LinkAckRequest {
  ids: string[];
}

/** `POST link.unpublish`: take the artifact off the host. */
export interface LinkUnpublishRequest {
  id: string;
}

/**
 * Whether a Link sync carries a path of an artifact folder: an archive path ({@link archiveIncludes}) but
 * `.artifact.json` and `history/` (see the module comment). Paths under `doc/` and `sheet/` are carried one way only,
 * from the host (`serverWrittenPath`).
 */
export function linkSynced(path: string): boolean {
  return archiveIncludes(path) && path !== '.artifact.json' && path !== 'history' && !path.startsWith('history/');
}

/** A content host's DNS label from an artifact id: `art_abc` → `art-abc` (an id has exactly one `_`). */
export function contentHostLabel(id: string): string {
  if (!ARTIFACT_ID.test(id)) throw new TypeError(`Not an artifact id: ${id}`);
  return id.replace('_', '-');
}

/** The artifact id a content host's DNS label names (`art-abc` → `art_abc`), or `null` when it names none. */
export function artifactIdOfLabel(label: string): string | null {
  const lower = label.toLowerCase();
  if (!lower.startsWith('art-')) return null;
  const id = `art_${lower.slice(4)}`;
  return ARTIFACT_ID.test(id) ? id : null;
}
