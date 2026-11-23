/**
 * The daemon's records and the Library API (`/api/open-artifact.*`): what the Shell,
 * the home page and host pages (such as the DSH plugin's Artifacts page)
 * list and change.
 *
 * Reads are `GET`; writes are `POST` with a JSON body, from the daemon's own
 * origin or with `Authorization: Bearer <daemon token>`.
 */

import type { ResolvedEntry, TypeRuntime, TypeScope } from './manifest.ts';
import type { SessionRef } from './refs.ts';
import type { ArtifactRole, ShareCloudView } from './type-server.ts';

/** The record the daemon keeps for one artifact (`artifacts/<id>.json`). */
export interface ArtifactRecord {
  id: string;
  /** Absolute path of the artifact folder. */
  root: string;
  /** Type id. */
  type: string;
  /** Marketplace the type came from, when known. */
  typeSource: string | null;
  /** Type version the artifact was made with. */
  typeRelease: string | null;
  /** The session that owns it: comments wake this session. */
  owner: SessionRef | null;
  createdBy: Pick<SessionRef, 'harness' | 'session'> | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinnedAt: string | null;
  openedAt?: string | null;
  /** Last time the agent read or wrote, to tell its edits from the person's. */
  agentSeenAt: string | null;
  lastUserEditAt: string | null;
  /**
   * Files people changed from the page, with when (paths as the type server
   * reported them, the newest 200). Artifact read lists those changed since
   * {@link agentSeenAt} as `changed_files`.
   */
  userEdits?: Record<string, string>;
  /** The cloud host this artifact is published to (its working copy syncs there through Link), or none. */
  remote?: ArtifactRemote | null;
  /**
   * Automatic publishing (`settings.cloud.publish: "auto"`): `pending` for an artifact created while it was on and not
   * on its site yet (the daemon publishes it in the background, retrying failures); `off` once the person unpublished
   * it, so it is never published by itself again. Absent for everything else (made before, or published by hand).
   */
  autoPublish?: 'pending' | 'off' | null;
  /**
   * A Data dashboard's live data goes to its host with it: `true` once the person confirmed it (publishing it from the
   * Share panel or the CLI, or "Publish its data" there), `false` once they took it back. Until then the daemon never
   * runs its queries for the host, so an automatic publish carries no rows. Absent for every other type.
   */
  dataPublish?: boolean | null;
}

/** Where an artifact is published on a cloud host, as {@link ArtifactRecord.remote}. */
export interface ArtifactRemote {
  /** Name of the remote in the daemon's remotes file, e.g. `work`. */
  name: string;
  /** The host's app origin. */
  host: string;
  /** The artifact's address on the host (`<host>/a/<id>`): what tools give as `view_url`. */
  url: string;
  /** Path -> etag (sha256 hex) at the last sync. */
  base: Record<string, string>;
  /** ISO time of the last sync, or `null` before the first. */
  syncedAt: string | null;
}

/** Where an artifact is published, as lists show it: {@link ArtifactRemote} without the sync bookkeeping (`base`). */
export type ArtifactRemoteView = Omit<ArtifactRemote, 'base'>;

/**
 * Why a remote or a published artifact's last sync failed, as a stable code beside its English `lastError`: the host
 * could not be reached (`unreachable`), the person must sign in again (`signed_out`), the id is taken there
 * (`conflict`), the artifact is larger than the host takes (`too_large`), the host refused otherwise (`refused`), or
 * anything else (`error`).
 */
export type RemoteErrorCode = 'unreachable' | 'signed_out' | 'conflict' | 'too_large' | 'refused' | 'error';

/** `.artifact.json` in the artifact folder: lets a moved folder be recognized. */
export interface ArtifactMarker {
  type: string;
  id: string;
  release: string | null;
}

/** Live state of the owner session. */
export type OwnerStatus = 'idle' | 'running' | 'offline';

/** One artifact as lists show it (`GET /api/open-artifact.artifacts`). */
export interface ArtifactView {
  id: string;
  url: string;
  title: string;
  type: string;
  typeTitle: string;
  /** The type is not installed any more. */
  typeMissing: boolean;
  root: string;
  /** The Shell page: `<daemon>/a/<id>`. */
  view_url: string;
  /** The page without the Shell. */
  page_url: string;
  owner: (SessionRef & { live: boolean; status: OwnerStatus }) | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  /** Last change of the content files. */
  contentAt: string | null;
  /** Thumbnail URL, when one was captured. */
  thumbnail: string | null;
  /** Shared on the LAN. */
  shared: boolean;
  /** A type server has the page open. */
  open: boolean;
  /** Set by a cloud host: the viewer's role on this artifact (own artifacts are `owner`). The daemon leaves it out. */
  role?: ArtifactRole;
  /**
   * Set by the daemon: where the artifact is published (its web address is `remote.url`), or `null` when it is local
   * only. The sync state is `GET remotes`'s. A cloud host leaves it out.
   */
  remote?: ArtifactRemoteView | null;
  /** Set by a cloud host in the trash list (`artifacts?trashed=1`): when the artifact went to the trash. */
  trashedAt?: string | null;
  /** Set by a cloud host on one artifact (`artifact?id=`): the owner's agent, for the Ask pane. */
  agent?: CloudAgentView;
}

/**
 * What a cloud host says of the artifact owner's agent: whether what is asked from the page reaches it now.
 *
 * - `online`: a computer the owner linked (`open-artifact remote add`) is connected now: it gets a request at once.
 * - `offline`: the owner linked a computer, and it is not connected: a request waits until it is.
 * - `mcp`: no computer connected, but an MCP client of the owner's used the site lately: its agent sees a request
 *   the next time it works on the artifact.
 * - `none`: no agent at all: a request waits until the owner connects one.
 */
export interface CloudAgentView {
  state: 'online' | 'offline' | 'mcp' | 'none';
  /** The agent's name as the owner labelled it (a linked computer's, an MCP client's), else a generic one. */
  name: string;
}

/**
 * `POST /api/open-artifact.artifacts.ask`'s answer from a cloud host: `via: 'link'` (kept in the owner's outbox), and
 * `status` `delivered` when the owner's linked computer is connected (it gets it now), else `inbox` (it waits).
 */
export interface CloudAskAnswer {
  via: 'link';
  status: 'delivered' | 'inbox';
}

/** `GET /api/open-artifact.artifact?id=`: one artifact with its folder size. */
export interface ArtifactDetail extends ArtifactView {
  bytes: number;
}

/** State of a type's local server. */
export interface TypeServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'failed';
  url?: string;
  pid?: number;
  error?: string;
  restarts?: number;
}

/** One type as the Types list shows it (`GET /api/open-artifact.types`). */
export interface TypeView {
  id: string;
  title: string;
  description: string;
  scope: TypeScope;
  /** The type root it was found in. */
  root: string;
  runtime: TypeRuntime;
  entry: ResolvedEntry['kind'] | null;
  server: TypeServerStatus | null;
  runnable: boolean;
  enabled: boolean;
  /** Id of the root whose type of the same id wins over this one. */
  shadowedBy: string | null;
  version: string | null;
  problems: string[];
  /** The type has an icon (`GET /api/open-artifact.type.icon?id=`). */
  icon: boolean;
}

/** `GET /api/open-artifact.types`. */
export interface TypesResponse {
  roots: Array<{ scope: TypeScope; dir: string }>;
  types: TypeView[];
}

/** One connected adapter (`GET /api/open-artifact.harnesses`). */
export interface HarnessInfo {
  name: string;
  title: string;
  agentName: string;
  connected: boolean;
  sessions: Array<SessionRef & { key: string; status: OwnerStatus; title?: string }>;
}

/** Events on `GET /api/open-artifact.events` (server-sent events, `data:` is JSON). */
export type LibraryEvent =
  | { type: 'artifacts/changed'; id: string; author?: string; paths?: string[]; removed?: boolean }
  | { type: 'types/changed' }
  | { type: 'harness/changed' }
  | { type: 'wake/state'; artifactId: string; via: string; status?: string };

/** `POST /api/open-artifact.artifacts.create`. */
export interface CreateArtifactRequest {
  type: string;
  title?: string;
  /** Folder (absolute). Default: `<homeWorkspace>/<artifactsDir>/<slug>`. */
  folder?: string;
  /** Hand the new artifact to an agent with this prompt. */
  prompt?: string;
}

/** `POST /api/open-artifact.artifacts.update`. */
export interface UpdateArtifactRequest {
  id: string;
  title?: string;
  pinned?: boolean;
}

/** `POST /api/open-artifact.artifacts.ask`: the person asks the owner agent from the Shell. */
export interface AskRequest {
  id: string;
  text: string;
  label?: string;
}

/** Library API route names (after `/api/open-artifact.`). */
export const LIBRARY_ROUTES = {
  artifacts: 'artifacts',
  artifact: 'artifact',
  types: 'types',
  harnesses: 'harnesses',
  events: 'events',
  share: 'artifact.share',
  /** `GET`/`HEAD ?id=`: the artifact's folder as a .zip (the type server's `/__open-artifact/archive`). */
  archive: 'artifact.archive',
  thumbnail: 'artifacts.thumbnail',
  restore: 'artifacts.restore',
  open: 'artifacts.open',
  /** `GET ?id=`: the finished {@link ShellBoot} of an artifact (waits for its page to open; never `pending`). */
  boot: 'artifacts.boot',
  preview: 'artifacts.preview',
  create: 'artifacts.create',
  update: 'artifacts.update',
  duplicate: 'artifacts.duplicate',
  delete: 'artifacts.delete',
  ask: 'artifacts.ask',
  adopt: 'artifacts.adopt',
  tools: 'tools',
} as const;

/**
 * What the daemon injects into the Shell page (`/a/<id>`) as its boot
 * object. The Shell reads it from `window.__OPEN_ARTIFACT_BOOT__`.
 */
export interface ShellBoot {
  /** The same Shell served by a type server for CLI and LAN visits, without the daemon library. */
  typeServer?: { role: 'owner' | 'editor' | 'commenter' | 'viewer'; invite?: string; sharePath?: string };
  id: string;
  url: string;
  title: string;
  type: string;
  typeTitle: string;
  root: string;
  /** The artifact page's address (absolute), once opened. */
  page: string | null;
  /** The page without the Shell. */
  pageUrl: string | null;
  pageKind: ResolvedEntry['kind'] | null;
  /**
   * The page is still being opened (its type server may be starting): `page`, `pageUrl`, `pageKind` and `problem`
   * are not known yet. The Shell draws itself at once and asks {@link LIBRARY_ROUTES.boot} for the finished boot.
   */
  pending?: boolean;
  /** Why the page could not be opened. */
  problem: string | null;
  /** Made but nothing written yet (none of the type's `detect` files exist). */
  empty: boolean;
  /** For an empty artifact: the prompt that hands it to an agent. */
  prompt: string | null;
  owner: { harness: string; key: string | null } | null;
  /** What the Shell calls the agent, e.g. `Agent`. */
  agentName: string;
  /** This computer's account name, shown as the owner in the Share panel. */
  userName: string;
  /** Daemon version. */
  version: string;
  /** Set when a cloud host serves the Shell: who is looking and how to sign in or out. `root` is `''` there. */
  cloud?: ShellCloud;
}

/** {@link ShellBoot.cloud}: the Shell as a cloud host serves it. */
export interface ShellCloud {
  /** The signed-in person; null for a link guest or an anonymous visitor. */
  user: { id: string; name: string; email?: string; avatar?: string } | null;
  /** The viewer's role on this artifact. */
  role: ArtifactRole;
  /** The host's app origin (Shell, home, sign-in, Library API). */
  appOrigin: string;
  /** Where to sign in, coming back to this artifact. */
  signInUrl: string;
  /** Where to sign out. */
  signOutUrl: string;
  /** The artifact's sharing settings, so the Shell can gate Ask and export before the share view loads. */
  settings?: ShareCloudView['settings'];
  /** The owner's agent, for the Ask pane (later changes come as `artifacts/changed` and the artifact's `agent`). */
  agent?: CloudAgentView;
  /** What the host's plugins add to its pages (links, the site's brand); absent when they add nothing. */
  site?: CloudSiteUi;
}

/**
 * A host's own additions to its pages, from its plugins (`ui`): plain text and checked addresses only (an `https:`
 * or `http:` URL, or a path on the host), never HTML.
 */
export interface CloudSiteUi {
  /** Links in the account menu (`account-menu`) or on the home page (`home`). */
  links?: Array<{ label: string; href: string; where: 'account-menu' | 'home' }>;
  /** The site's name and logo, shown in the top bar, the home page's header and the sign-in page. */
  brand?: { name?: string; logoUrl?: string };
}

/**
 * What a cloud host inlines into the home page (`window.__OPEN_ARTIFACT_HOME__`); the local daemon leaves it `null`.
 * The cloud part is {@link ShellCloud} without an artifact's role or settings.
 */
export interface HomeBoot {
  cloud?: Omit<ShellCloud, 'role' | 'settings' | 'agent'> & {
    /** Days an artifact stays in the trash before the host deletes it for good (`OA_TRASH_DAYS`; 0: until purged). */
    trashDays?: number;
    /** What the host accepts: `importBytes`, the largest archive (zip) an upload may be. */
    limits?: { importBytes: number };
  };
}

/** `~/.agents/open-artifact/daemon.json`: how clients find the running daemon. */
export interface DaemonState {
  /** Base URL, e.g. `http://127.0.0.1:4800`. */
  url: string;
  port: number;
  pid: number;
  /** Bearer token of the Library and Harness APIs. */
  token: string;
  version: string;
  startedAt: string;
}

/** `GET /__open-artifact/health` on the daemon. */
export interface DaemonHealth {
  openArtifact: 1;
  version: string;
}
