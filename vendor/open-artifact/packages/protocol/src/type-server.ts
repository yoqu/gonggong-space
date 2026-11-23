/**
 * The type server protocol: how the daemon starts and drives a local type
 * server (`entry.start`), and the Type API (`/api/open-artifact.type.*`) the server
 * calls back.
 *
 * Start-up:
 *
 * 1. The daemon runs `entry.start` in the type folder with the
 *    {@link TypeServerEnv} variables.
 * 2. Within {@link READY_TIMEOUT_MS} the server prints one
 *    {@link ReadyLine} to stdout.
 * 3. The daemon probes `GET /__open-artifact/health` every {@link HEALTH_INTERVAL_MS};
 *    after {@link HEALTH_MISSES} misses the server counts as stopped and is
 *    restarted with back-off, up to {@link MAX_RESTARTS} failures.
 *
 * Every `/__open-artifact/*` call carries `Authorization: Bearer <OPEN_ARTIFACT_SECRET>`.
 */

import type { WakeRequestItem, WakeStatus, WakeThread, WakeVia } from './wake.ts';

/** How long a type server has to print its ready line, ms. */
export const READY_TIMEOUT_MS = 15_000;
/** Interval of health probes, ms. */
export const HEALTH_INTERVAL_MS = 30_000;
/** Missed probes after which a server counts as stopped. */
export const HEALTH_MISSES = 3;
/** Failed starts after which the daemon gives up on a type server. */
export const MAX_RESTARTS = 5;

/** Environment variables the daemon passes to a type server. */
export interface TypeServerEnv {
  /** Protocol version, `1`. */
  OPEN_ARTIFACT_PROTOCOL: string;
  /** Type id. */
  OPEN_ARTIFACT_TYPE: string;
  /** Absolute path of the type folder. */
  OPEN_ARTIFACT_TYPE_DIR: string;
  /** Port to listen on (`0`: pick one). */
  OPEN_ARTIFACT_PORT: string;
  /** Bearer secret of the `/__open-artifact/*` routes. */
  OPEN_ARTIFACT_SECRET: string;
  /** Base URL of the daemon. */
  OPEN_ARTIFACT_DAEMON_URL: string;
  /** Bearer token of the Type API. */
  OPEN_ARTIFACT_TYPE_TOKEN: string;
  /** Folder the server may keep state in. */
  OPEN_ARTIFACT_STATE_DIR: string;
}

/** The line a type server prints to stdout once it listens. */
export interface ReadyLine {
  openArtifact: 'ready';
  /** Base URL of the server, e.g. `http://127.0.0.1:4721`. */
  url: string;
}

/** `/__open-artifact/*` route paths on a type server. */
export const TYPE_SERVER_ROUTES = {
  health: '/__open-artifact/health',
  open: '/__open-artifact/open',
  close: '/__open-artifact/close',
  share: '/__open-artifact/share',
  actions: '/__open-artifact/actions/',
  summary: '/__open-artifact/summary',
  archive: '/__open-artifact/archive',
} as const;

/** `GET /__open-artifact/health`. */
export interface TypeServerHealth {
  openArtifact: 1;
  type: string;
  version?: string;
  /** Artifacts with an open page. */
  open?: number;
}

/** `POST /__open-artifact/open`: open (or find) the page of one artifact. */
export interface OpenRequest {
  id: string;
  /** Absolute path of the artifact folder. */
  root: string;
  title?: string;
  /** Preferred UI language, e.g. `en` or `zh-CN`. */
  lang?: string;
  /** Origin of the Shell that will frame the page. */
  shell?: string;
  /**
   * The Shell's own address for this artifact (absolute, on the `shell` origin), e.g. `http://127.0.0.1:4800/a/art_1`.
   * A visit to the framed page as a top-level document (`Sec-Fetch-Dest: document`) is sent there instead of
   * showing the page without its Shell.
   */
  viewer?: string;
}

/** `POST /__open-artifact/open` answer. */
export interface OpenResult {
  /** The page to frame (absolute, may carry a capability token). */
  url: string;
  /** The page without the Shell, when different. */
  page_url?: string;
}

/** `POST /__open-artifact/close`. */
export interface CloseRequest {
  id: string;
}

/** `POST /__open-artifact/share`: change LAN sharing. `GET /__open-artifact/share?id=` reads it. */
export interface ShareRequest {
  id: string;
  /** Open (`true`) or stop (`false`) sharing on the local network. */
  lan?: boolean;
  /** Turn each role's link on or off. */
  links?: Partial<Record<ShareRole, boolean>>;
  /** Roles whose link gets a new token: the old link stops working and the guests who joined with it are out. */
  reset?: ShareRole[];
  /** Guest id → a new role (its link must be on), or `null` to remove them. */
  guests?: Record<string, ShareRole | null>;
  /** Cloud host: who may open the artifact without being named. */
  access?: GeneralAccess;
  /** Cloud host: {@link CloudMember.id} → a new role, or `null` to remove them. */
  members?: Record<string, ShareRole | null>;
  /** Cloud host: change some of the artifact's sharing settings. */
  settings?: Partial<ShareCloudView['settings']>;
}

/** A role a share link grants. */
export type ShareRole = 'editor' | 'commenter' | 'viewer';

/** A role on an artifact: its owner's, or one sharing grants. */
export type ArtifactRole = 'owner' | ShareRole;

/**
 * Who may open an artifact on a cloud host without being named: only its members (`restricted`), anyone with a share
 * link (`link`), or anyone at all (`public`, as a viewer).
 */
export type GeneralAccess = 'restricted' | 'link' | 'public';

/** Someone an artifact is shared with on a cloud host: a person, an invited address, a domain or a group. */
export interface CloudMember {
  /** `user:<id>`, `email:<address>`, `domain:<name>` or `group:<provider>:<name>`. */
  id: string;
  kind: 'user' | 'email' | 'domain' | 'group';
  /** What the Share panel shows: a name, an address, a domain or a group name. */
  label: string;
  email?: string;
  /** Picture URL. */
  avatar?: string;
  role: ShareRole;
  /** An invited address nobody has signed in with yet. */
  pending?: boolean;
}

/** {@link ShareView.cloud}: sharing on a cloud host. */
export interface ShareCloudView {
  /** The artifact's address on the host. */
  url: string;
  access: GeneralAccess;
  owner: { id: string; name: string; email?: string; avatar?: string };
  members: CloudMember[];
  /** Whether this viewer may change sharing. */
  canManage: boolean;
  settings: {
    /** People who may only view may still download or export it. */
    viewersCanExport: boolean;
    /** Editors may send requests to the owner's agent. */
    editorsCanAskAgent: boolean;
  };
}

/** Someone who joined through a share link. */
export interface ShareGuest {
  id: string;
  /** The name they typed when they joined. */
  name: string;
  role: ShareRole;
  /** ISO time they joined. */
  joined: string;
  /** ISO time they were last seen. */
  seen?: string;
  /** They have the page open now. */
  online: boolean;
  /** Their link is on (and was not reset): `false` while it is off. */
  active: boolean;
}

/** Sharing state of one artifact. */
export interface ShareView {
  lan: boolean;
  /** Addresses on the local network, when shared (a Tailscale address among them). */
  addresses?: string[];
  /** The port the links are on. */
  port?: number;
  links: Partial<Record<ShareRole, { on: boolean; url?: string }>>;
  /** The people who joined: online or not, their link on or off. */
  guests?: ShareGuest[];
  /** The same links at this computer's Tailscale address (the roles whose link is on), for people on the tailnet. */
  tailnet?: { address: string; links: Partial<Record<ShareRole, string>> };
  /** Set by a cloud host, which has no local network sharing (`lan` is `false` there). */
  cloud?: ShareCloudView;
}

/**
 * `GET /__open-artifact/archive?id=`: the artifact's whole folder as one
 * `.zip` (`Content-Disposition` names it), streamed; `HEAD` answers the same
 * headers without zipping, or 413 `too_large` for a folder over what a plain
 * zip holds (4 GiB, 65 535 files). The daemon passes it on as the Library
 * API's `artifact.archive`.
 */
export const ARCHIVE_CONTENT_TYPE = 'application/zip';

/**
 * Reserved action names a server with `actions: true` may implement; the
 * daemon uses them for the ArtifactData and ArtifactComments tools when the
 * server owns those stores. Other names are the type's own (`check`,
 * `upload`…). An unknown name answers 404 `unknown_action`.
 */
export const RESERVED_ACTIONS = ['open-artifact.db.read', 'open-artifact.db.write', 'open-artifact.comments.read', 'open-artifact.comments.reply', 'open-artifact.comments.resolve'] as const;

/** A reserved action name. */
export type ReservedAction = (typeof RESERVED_ACTIONS)[number];

/** `POST /__open-artifact/actions/<name>` body. */
export interface ActionRequest {
  id: string;
  root: string;
  args: Record<string, unknown>;
}

/** `GET /__open-artifact/summary?id=`: a short text summary of an artifact for agents. */
export interface SummaryResult {
  text: string;
}

// ---- Type API ----------------------------------------------------------------------------------------------------

/** Type API route names, after `/api/open-artifact.type.`. Bearer `OPEN_ARTIFACT_TYPE_TOKEN`, loopback only. */
export const TYPE_API_ROUTES = {
  artifact: 'artifact',
  wake: 'wake',
  presence: 'presence',
  events: 'events',
  touch: 'touch',
  task: 'task',
} as const;

/** `GET /api/open-artifact.type.artifact?id=`. */
export interface TypeApiArtifact {
  id: string;
  url: string;
  root: string;
  title: string;
  owner: { label: string; harness: string } | null;
  agentName: string;
  view_url: string;
}

/** `POST /api/open-artifact.type.wake`. */
export interface TypeApiWakeRequest {
  id: string;
  threads?: WakeThread[];
  requests?: Array<Omit<WakeRequestItem, 'id'> & { id?: string }>;
}

/** `POST /api/open-artifact.type.wake` answer. */
export interface TypeApiWakeResult {
  status: WakeStatus;
  via: WakeVia;
}

/** Whether an agent is there to receive. `GET /api/open-artifact.type.presence?id=`. */
export interface TypeApiPresence {
  /** `online`: the owner's adapter is connected; `offline`: it is not; `none`: no owner. */
  presence: 'online' | 'offline' | 'none';
  canSend: boolean;
  canSendSession: boolean;
  busy: boolean;
  agentName: string;
  /** false: an idle owner session is not woken; what is sent waits for its next turn. Left out: it is woken. */
  wakesIdle?: boolean;
}

/** Events of `GET /api/open-artifact.type.events?ids=<id,id>` (server-sent, `event:` is the type). */
export type TypeApiEvent =
  | ({ type: 'presence'; id: string } & TypeApiPresence)
  | { type: 'artifact'; id: string; title?: string; removed?: boolean };

/** `POST /api/open-artifact.type.touch`: the page wrote files. */
export interface TypeApiTouch {
  id: string;
  /** Who wrote: a viewer name or `agent`. */
  author: string;
  paths: string[];
  /** New title, when the write changed it. */
  title?: string;
}

/**
 * `POST /api/open-artifact.type.task`: progress and end of a long action (one that
 * answered `{task, pending: true}`). With `done`, the daemon hands `result`
 * (or `error`) to the session that called the action, as a message that
 * starts with {@link TASK_HEADER}.
 */
export interface TypeApiTask {
  task: string;
  done?: boolean;
  /** 0 to 1; logged only. */
  progress?: number;
  /** With `done`: what the action returns. */
  result?: unknown;
  /** With `done`: why it failed. */
  error?: string | { code: string; message: string; fix?: string };
}
