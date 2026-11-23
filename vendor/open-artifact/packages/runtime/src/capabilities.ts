/**
 * Capability contracts of the Open Artifact page runtime.
 *
 * A type's page (an editor such as Design or Design System) never talks to its
 * host directly. It asks `window.openartifact.use(name)` for a capability
 * namespace and calls the methods below. The host decides which capabilities a
 * given viewer gets: `use()` resolves to `null` when a capability is not
 * available for this view (read-only viewer, no host, unknown name).
 *
 * Every method is asynchronous and may reject with an {@link ArtifactError}.
 */

import type {
  ImportFileResponse,
  SheetFrame,
  SheetWalkthrough,
  SheetReadAnswers,
  SheetReadRefusal,
  SheetReadRequest,
  SheetSendRequest,
  SheetSendResponse,
  WidgetRequest,
  WidgetResponse,
} from './sheet-api.ts';
import type {
  DocCallAnswer,
  DocCallRequest,
  DocExportFormat,
  DocFrame,
  DocHistoryResponse,
  DocImportResponse,
  DocPaper,
  DocRestoreRequest,
  DocRestoreResponse,
  DocSessionResponse,
  DocTabResponse,
  DocVersionResponse,
} from './doc-api.ts';

/** Version of the capability contract described in this file. */
export const CONTRACT_VERSION = '1.4.0';

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Machine-readable error codes a capability call may reject with. */
export type ArtifactErrorCode =
  /** A write lost a race: at least one `ifMatch` hash no longer matches. */
  | 'conflict'
  /** The viewer may not write (viewer or commenter role). */
  | 'not_writer'
  /** The capability exists but the viewer declined or was never granted it. */
  | 'not_granted'
  /** The request was malformed (bad path, too large, wrong shape). */
  | 'invalid'
  /** The file or resource does not exist. */
  | 'not_found'
  /** The host could not be reached or answered with an unexpected status. */
  | 'unavailable'
  /** A connector (`mcp`) call failed; see {@link McpErrorCode}. */
  | McpErrorCode;

/** One path that failed an optimistic-concurrency check. */
export interface ConflictPath {
  /** Artifact-relative path, e.g. `project/Main.dc.html`. */
  path: string;
  /** The hash the writer expected (`null`: expected the file to be absent). */
  expected: string | null;
  /** The hash currently stored (`null`: the file is absent). */
  actual: string | null;
}

/** The error object every capability rejects with. */
export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode;
  /** Present for `conflict`: every path whose `ifMatch` failed. */
  readonly paths?: ConflictPath[];
  /** Present when asking again later may succeed (a busy or timed-out connector). */
  readonly retryable?: boolean;

  constructor(code: ArtifactErrorCode, message: string, paths?: ConflictPath[], retryable?: boolean) {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
    if (paths) this.paths = paths;
    if (retryable) this.retryable = true;
  }
}

/** Type guard for {@link ArtifactError} that also works across realms (iframes). */
export function isArtifactError(value: unknown, code?: ArtifactErrorCode): value is ArtifactError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; code?: unknown };
  if (candidate.name !== 'ArtifactError' || typeof candidate.code !== 'string') return false;
  return code === undefined || candidate.code === code;
}

/* -------------------------------------------------------------------------- */
/* Shared JSON types                                                          */
/* -------------------------------------------------------------------------- */

/** A JSON value. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. */
export type JsonRecord = { [key: string]: JsonValue };

/* -------------------------------------------------------------------------- */
/* artifact: the artifact's own files                                          */
/* -------------------------------------------------------------------------- */

/** Metadata of one stored file. */
export interface FileEntry {
  /** Lower-case hex SHA-256 of the file's bytes. */
  sha256: string;
  /** Size in bytes. */
  size: number;
}

/** A listing of every file of the artifact, keyed by artifact-relative path. */
export type FileListing = Record<string, FileEntry>;

/** One file in a publish batch. */
export interface PublishFile {
  /** Text content (UTF-8), or base64 when `encoding` is `base64`. */
  content: string;
  encoding?: 'utf8' | 'base64';
  /**
   * Optimistic-concurrency guard: the hash the writer last saw.
   * `null` means "the file must not exist yet". Omit to write unconditionally.
   */
  ifMatch?: string | null;
}

/** A publish batch: `null` deletes the path. */
export type PublishBatch = Record<string, PublishFile | null>;

/** The result of a successful publish. */
export interface PublishResult {
  /** New hash of every written path; `null` for deleted paths. */
  hashes: Record<string, string | null>;
}

/** A change pushed by the host: written by someone else (agent, another tab). */
export interface FilesChangedEvent {
  /** Path → new hash, or `null` when the file was deleted. */
  changes: Record<string, string | null>;
  /** Who made the change, when the host knows (`agent`, `owner`, `guest:<name>`). */
  author?: string;
}

/** The `artifact` capability. */
export interface SystemCopyStatus {
  state: 'current' | 'behind' | 'missing' | 'unavailable';
  changed: number;
  removed: number;
}

export interface ArtifactCapability {
  /** Compare or refresh an installed design system from its recorded source. */
  systemCopy?(namespace: string, action: 'status' | 'sync'): Promise<SystemCopyStatus>;
  /** Stable artifact id. */
  readonly id: string;
  /** Current title as recorded by the host. */
  title(): Promise<string>;
  /** Lists every file with its hash. */
  list(): Promise<FileListing>;
  /** Reads a text file; rejects with `not_found` when absent. */
  readText(path: string): Promise<string>;
  /** Reads a file as bytes. */
  readBytes(path: string): Promise<Uint8Array>;
  /**
   * Writes a batch atomically. Rejects with `conflict` (listing every stale
   * path, nothing written) or `not_writer`.
   */
  publish(batch: PublishBatch): Promise<PublishResult>;
  /**
   * Subscribes to changes made by anyone else. The host suppresses echoes of
   * this page's own publishes. Returns an unsubscribe function.
   */
  onChange(listener: (event: FilesChangedEvent) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* assets: content-addressed uploads                                          */
/* -------------------------------------------------------------------------- */

/** A stored upload. Pages reference it only by `url` (`/_blob/<id>`). */
export interface AssetRecord {
  /** First 32 hex digits of the SHA-256 of the bytes. */
  id: string;
  /** Root-relative URL, always `/_blob/<id>`. */
  url: string;
  sizeBytes: number;
  contentType: string;
}

/** The `assets` capability. */
export interface AssetsCapability {
  /** Uploads bytes; identical bytes always produce the same record. */
  upload(data: Blob, options?: { name?: string }): Promise<AssetRecord>;
}

/* -------------------------------------------------------------------------- */
/* user: who is looking                                                       */
/* -------------------------------------------------------------------------- */

/** Roles, from most to least privileged. */
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';

/** The current viewer. */
export interface Viewer {
  id: string;
  name: string;
  role: Role;
  /** Who they are on a cloud host: a signed-in person, a link guest, an agent or an anonymous visitor. Unset locally. */
  kind?: 'user' | 'guest' | 'agent' | 'anonymous';
  /** Their address, on a cloud host that knows it. */
  email?: string;
  /** Their picture's URL, on a cloud host that knows it. */
  avatar?: string;
}

/** The `user` capability. */
export interface UserCapability {
  me(): Promise<Viewer>;
}

/** True when the role may change files and upload assets. */
export function canEdit(role: Role): boolean {
  return role === 'owner' || role === 'editor';
}

/* -------------------------------------------------------------------------- */
/* agent: hand a request to the agent that owns the artifact                   */
/* -------------------------------------------------------------------------- */

/** A request a page sends to the agent ("Send to agent", "Ask agent to fix"). */
export interface AgentRequest {
  /** What the person asked for, in their words (already fenced if untrusted). */
  text: string;
  /** Short label for cards and logs, e.g. `Ask agent to fix`. */
  title?: string;
  /** Structured context: selection ids, labels, error text. Data, never instructions. */
  context?: Record<string, unknown>;
}

/** How the request should arrive. */
export type AgentDelivery =
  /** Start an agent turn now (falls back to queueing when the agent is away). */
  | 'send'
  /** Only prefill the person's composer; never start a turn. */
  | 'stage';

/** The outcome of {@link AgentCapability.send}. */
export interface AgentSendResult {
  status: 'delivered' | 'queued' | 'staged' | 'failed';
  /** Human-readable reason when `failed`. */
  reason?: string;
}

/** Whether an agent is reachable and working. */
export interface AgentStatus {
  /** An agent can receive requests (it waits, or a harness can wake it). */
  available: boolean;
  /** The agent is currently changing this artifact. */
  busy: boolean;
  /** Display name, e.g. `Agent`. */
  name: string;
  /** false: an idle agent is not woken; what is sent waits until the person next talks to it. Left out: it is woken. */
  wakesIdle?: boolean;
  /**
   * true: the agent asked the person something (a form, a question in the chat) and its work waits on the answer.
   * It is still at work, so pages show that it waits on them rather than that it stopped. Left out: it does not.
   */
  waitingForPerson?: boolean;
}

/** The `agent` capability. */
export interface AgentCapability {
  send(request: AgentRequest, options?: { deliver?: AgentDelivery }): Promise<AgentSendResult>;
  status(): Promise<AgentStatus>;
  onStatus(listener: (status: AgentStatus) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* room: presence, carrying the view context                                  */
/* -------------------------------------------------------------------------- */

/** One viewer (or the agent) present on the artifact. */
export interface Peer {
  id: string;
  name: string;
  kind: 'person' | 'agent';
  /** Whatever the peer last published with {@link RoomCapability.presence}. */
  state: Record<string, unknown>;
}

/**
 * An ephemeral message between the pages of one artifact (live strokes,
 * drag previews, reactions). Never stored; a page that is not connected
 * when it is sent never sees it.
 */
export interface RoomMessage {
  /** Peer id of the sender (see {@link RoomCapability.self}). */
  from: string;
  /** Free-form channel name chosen by the type, e.g. `gesture`. */
  topic: string;
  /** JSON payload, at most {@link ROOM_MESSAGE_MAX_BYTES} once serialized. */
  data: JsonValue;
}

/** Largest serialized {@link RoomMessage.data} a host relays. */
export const ROOM_MESSAGE_MAX_BYTES = 16_384;

/** The `room` capability. */
export interface RoomCapability {
  /** This page's own peer id (its entry in {@link peers}). */
  self(): Promise<string>;
  /**
   * Publishes (merges) this viewer's presence state; a `null` value removes
   * a key. The `viewContext` key is what the agent receives before the
   * viewer's next message.
   */
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): Promise<Peer[]>;
  onPeers(listener: (peers: Peer[]) => void): () => void;
  /** Relays an ephemeral message to every other page of the artifact. */
  emit(topic: string, data: JsonValue): Promise<void>;
  /** Subscribes to ephemeral messages from other pages. */
  onMessage(listener: (message: RoomMessage) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* downloads: hand a generated file to the host to save                       */
/* -------------------------------------------------------------------------- */

/** The `downloads` capability. */
export interface DownloadsCapability {
  /** Saves a file. The local host takes a single file of up to 512 MB; other hosts may take less. */
  save(file: { name: string; data: Blob }): Promise<{ savedTo?: string }>;
  /**
   * True when the host saves each file as this browser's own download rather than on a computer of its own (a cloud
   * host): any role may then ask, the host decides whether the person may export, and there is no size limit but the
   * browser's.
   */
  readonly browser?: boolean;
  /**
   * Where `browser` is true: resolves when the person may export now, else rejects with `not_writer` and the host's
   * words. For an export that is not a file (a print): it follows the same switch. That keeps the product's own
   * buttons consistent; it is no security boundary (a viewer can always print from the browser or take a screenshot).
   */
  check?(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* db: a small document store                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A document path: an even number of segments alternating collection and
 * document id (`elements/n-12`, `data/users/u1/idea`). Segments match
 * `[A-Za-z0-9_.~:@+-]+` and are never `.` or `..`.
 */
export type DbPath = string;

/** One stored document. */
export interface DbDocument {
  path: DbPath;
  data: JsonRecord;
}

/**
 * A write's precondition: write only while the document is still the one the
 * writer read. `ifMatch` is that document's sha256 (lowercase hex of its data
 * as compact JSON, `JSON.stringify`, UTF-8: what the agent's tools call
 * `sha256`), or `null` for "only while it does not exist". When one fails
 * the whole batch is refused with `conflict`, its `paths` naming each
 * document (`expected`, `actual`), and nothing is written. Omit it to write
 * unconditionally.
 */
export interface DbWriteGuard {
  ifMatch?: string | null;
}

/** One write of a {@link DbCapability.write} batch. */
export type DbWrite =
  /** Replaces the document (creating it when absent). */
  | ({ op: 'set'; path: DbPath; data: JsonRecord } & DbWriteGuard)
  /**
   * Applies a JSON merge patch (RFC 7396): objects merge, arrays and
   * scalars replace, `null` removes a key. An absent document starts empty.
   */
  | ({ op: 'update'; path: DbPath; patch: JsonRecord } & DbWriteGuard)
  /** Removes the document (a no-op when it is absent). */
  | ({ op: 'delete'; path: DbPath } & DbWriteGuard);

/** Documents changed by someone else (agent, another page). */
export interface DbChangeEvent {
  /** Path → the document's new data, or `null` when it was deleted. */
  changes: Record<DbPath, JsonRecord | null>;
  /** Who made the change, when the host knows (`agent`, `owner`, a peer id). */
  author?: string;
}

/** Limits every host enforces on the document store. */
export const DB_LIMITS = {
  /** Writes in one batch. */
  maxWrites: 500,
  /** Bytes of one document's JSON. */
  maxDocumentBytes: 262_144,
  /** Nesting depth of one document. */
  maxDepth: 32,
} as const;

/** The `db` capability, granted to types whose manifest declares `store: "db"`. */
export interface DbCapability {
  /** Reads one document; `null` when absent. */
  get(path: DbPath): Promise<JsonRecord | null>;
  /** Every document of one collection (`elements`, `data/users/u1/ideas`), sorted by path. */
  list(collection: string): Promise<DbDocument[]>;
  /**
   * Applies a batch in order, all or nothing. Rejects with `invalid` (bad
   * path, too large), `conflict` (an `ifMatch` no longer holds) or `not_writer`. The host never echoes the batch back
   * through {@link onChange}.
   */
  write(writes: DbWrite[]): Promise<void>;
  /** Subscribes to changes made by anyone else. Returns an unsubscribe function. */
  onChange(listener: (event: DbChangeEvent) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* comments: review threads anchored by the type                              */
/* -------------------------------------------------------------------------- */

/** Who wrote a comment message. */
export interface CommentAuthor {
  kind: 'person' | 'agent';
  name: string;
}

/** People who reacted to a message with one emoji. */
export interface CommentReaction {
  emoji: string;
  authors: CommentAuthor[];
}

/** One message of a thread. */
export interface CommentMessage {
  id: string;
  author: CommentAuthor;
  text: string;
  /** ISO 8601 time. */
  at: string;
  /** ISO 8601 time of the last edit. */
  editedAt?: string;
  /** Who the message asks, as the page named them (`agent` asks the agent). */
  to?: string[];
  reactions?: CommentReaction[];
  /** The agent's reply to a message sent to it without asking it: it joined without being asked. */
  joined?: boolean;
}

/** What {@link CommentsCapability.sendToAgent} takes besides the thread. */
export interface CommentSendOptions {
  /**
   * The newest message does not ask the agent (no `@agent`) but goes to it because it took part in the thread: it
   * decides whether to answer, and the thread keeps its status.
   */
  unasked?: boolean;
}

/** What {@link CommentsCapability.reply} takes besides the text. */
export interface CommentReplyOptions {
  to?: string[];
}

/** Where a thread stands with the agent. */
export interface CommentAgentState {
  /** `pending`: sent, not yet read; `delivered`: the agent has it; `replied`: it answered. */
  status: 'pending' | 'delivered' | 'replied';
}

/** A comment thread. */
export interface CommentThread {
  id: string;
  /**
   * The type's own anchor, serialized (a board stores a JSON object naming
   * an element and an offset). Opaque to the host.
   */
  anchor: string;
  /** Short human label of what the thread is about (`Note "Q3 goals"`). */
  label: string;
  /** Longer description of the anchored content, for the agent. */
  detail?: string;
  /** Extra structured location (coordinates, element ids), for the agent. */
  location: JsonRecord;
  status: 'open' | 'resolved';
  /** Who resolved it, while it is resolved (when the host knows). */
  resolvedBy?: CommentAuthor;
  agent?: CommentAgentState;
  messages: CommentMessage[];
}

/** What {@link CommentsCapability.create} takes. */
export interface CommentCreate {
  anchor: string;
  label: string;
  detail?: string;
  location?: JsonRecord;
  /** The first message. */
  text: string;
  /** Who the first message asks. */
  to?: string[];
}

/** The `comments` capability, granted to types whose manifest declares `comments: true`. */
export interface CommentsCapability {
  /** Every thread, open and resolved. */
  list(): Promise<CommentThread[]>;
  create(input: CommentCreate): Promise<CommentThread>;
  reply(threadId: string, text: string, options?: CommentReplyOptions): Promise<CommentThread>;
  /** Changes the text of one of the viewer's own messages. */
  edit(threadId: string, messageId: string, text: string, options?: CommentReplyOptions): Promise<CommentThread>;
  /** Adds (`on`) or takes back the viewer's reaction to a message. */
  react(threadId: string, messageId: string, emoji: string, on: boolean): Promise<CommentThread>;
  setResolved(threadId: string, resolved: boolean): Promise<CommentThread>;
  /** Re-anchors a thread (its content moved or was replaced). */
  move(threadId: string, anchor: string, location?: JsonRecord): Promise<CommentThread>;
  /** Deletes one message, or the whole thread when `messageId` is omitted. */
  remove(threadId: string, messageId?: string): Promise<void>;
  /** Hands the thread to the agent (status `pending` until it reads it; `unasked` keeps the status). */
  sendToAgent(threadId: string, options?: CommentSendOptions): Promise<CommentThread>;
  /** Subscribes to the full thread list whenever anyone changes it. */
  onChange(listener: (threads: CommentThread[]) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* history: versions of the artifact                                          */
/* -------------------------------------------------------------------------- */

/** Who made a version: a person on the page, the agent (any change on disk), or the system (the first version). */
export interface HistoryAuthor {
  kind: 'person' | 'agent' | 'system';
  id: string;
  name: string;
}

/** One path a version changed. Paths are `project/…` files or `db/<collection>/<doc>` documents. */
export interface HistoryFileChange {
  path: string;
  op: 'added' | 'edited' | 'deleted';
}

/**
 * One version: an author's burst of changes (it ends after a 30 s pause or
 * 5 min), or a restore.
 */
export interface HistoryVersion {
  /** Numbers the versions from 1, never reused. */
  n: number;
  /** First and last change in it (ISO 8601). */
  first: string;
  at: string;
  author: HistoryAuthor;
  /** What it changed, sorted by path. */
  files: HistoryFileChange[];
  /** A restore: the version it brought back. */
  restoredFrom?: number;
  /** The newest version: what the files hold now. */
  current?: true;
  /** Changes made moments before by someone else that this version undid, at least in part. */
  overwrote?: { path: string; n: number; author: HistoryAuthor }[];
}

/**
 * A notice to the viewer: someone else's version `n` undid part of their
 * change to `path` (version `lost.n`). Bring it back with
 * `restore(lost.n, [path])`; it goes away by itself then.
 */
export interface HistoryNotice {
  id: string;
  at: string;
  path: string;
  n: number;
  author: HistoryAuthor;
  lost: { n: number; author: HistoryAuthor; deleted?: true };
}

/** What {@link HistoryCapability.list} answers. */
export interface HistoryListing {
  /** Newest first. */
  versions: HistoryVersion[];
  /** The viewer's notices, newest first. */
  notices: HistoryNotice[];
  /** The viewer may restore (owner or editor). */
  canRestore: boolean;
}

/**
 * One path before and after a version, for a diff. `null`: the file did
 * not exist on that side. Contents are left out (`null`) when `binary` or
 * `tooLarge`.
 */
export interface HistoryFileDiff {
  path: string;
  n: number;
  op: HistoryFileChange['op'];
  before: string | null;
  after: string | null;
  binary?: true;
  tooLarge?: true;
}

/** What {@link HistoryCapability.restore} answers. */
export interface HistoryRestoreResult {
  /** The version the restore made (`null`: everything already matched). */
  version: number | null;
  /** The paths it wrote or deleted. */
  changed: string[];
}

/** The history changed: `n` is the newest version (it may be one that grew). */
export interface HistoryChangeEvent {
  n: number | null;
}

/**
 * The `history` capability: the artifact's versions, read-only previews of
 * them, and restores. A restore writes through the host's normal write path
 * (every open page hears of it) and is a version of its own.
 */
export interface HistoryCapability {
  /** Every kept version (newest first) and the viewer's notices. */
  list(): Promise<HistoryListing>;
  /** Every path as it was right after version `n`, with its hash and size. */
  files(n: number): Promise<FileListing>;
  /** A text file (or a document's JSON) as it was right after version `n`; rejects `not_found`. */
  read(n: number, path: string): Promise<string>;
  /** The same as bytes. */
  readBytes(n: number, path: string): Promise<Uint8Array>;
  /** One path right before and right after version `n` (a path version `n` changed). */
  diff(n: number, path: string): Promise<HistoryFileDiff>;
  /**
   * Brings version `n` back: every path (default) or only `paths`. Rejects
   * `not_writer` for readers, `not_found` for a version no longer kept.
   */
  restore(n: number, paths?: string[]): Promise<HistoryRestoreResult>;
  /** Dismisses one of the viewer's notices. */
  dismissNotice(id: string): Promise<void>;
  /** Subscribes to new versions. Returns an unsubscribe function. */
  onChange(listener: (event: HistoryChangeEvent) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* doc: a doc of tabs whose blocks and characters carry ids                   */
/* -------------------------------------------------------------------------- */

/** What {@link DocCapability.exportFile} asks for. */
export interface DocExportQuery {
  format: DocExportFormat;
  /** One tab (default: every tab). */
  tab?: string;
  paper?: DocPaper;
}

/** An exported file. */
export interface DocExportedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** What the file could not carry over. */
  notes: { code: string; message: string; count?: number }[];
}

/**
 * The `doc` capability, granted to types whose manifest declares `store: "doc"`. A page takes a writing session,
 * reads tabs and sends its edits as ops on the revision it holds; every write anyone else makes arrives as a frame.
 * A write is refused in the answer (`verdict: "deny"`), not by a rejection.
 */
export interface DocCapability {
  /** This page's writing session (`sess` is `null` for a reader) and the doc. */
  session(): Promise<DocSessionResponse>;
  /** A tab as the host holds it. */
  read(tab: string): Promise<DocTabResponse>;
  /** One member or a batch, on the session's behalf; `opId` makes it safe to send again. */
  call(request: DocCallRequest): Promise<DocCallAnswer>;
  /** A tab's kept versions, newest first. */
  history(tab: string): Promise<DocHistoryResponse>;
  /** A tab as it stood at a kept rev. */
  version(tab: string, rev: number): Promise<DocVersionResponse>;
  /** Brings a tab back as it was at `rev`, as a new write. */
  restore(request: DocRestoreRequest): Promise<DocRestoreResponse>;
  /** A .md, .docx or .pdf file as a new tab (`tabName`: its name). */
  importFile(name: string, bytes: Uint8Array, tabName?: string): Promise<DocImportResponse>;
  /** The doc, or one tab, as a file. */
  exportFile(query: DocExportQuery): Promise<DocExportedFile>;
  /** Subscribes to every write, tab and list change. Returns an unsubscribe function. */
  onFrame(listener: (frame: DocFrame) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* mcp: tools of the connectors (MCP servers) the owner set up                */
/* -------------------------------------------------------------------------- */

/**
 * Codes a connector call rejects with (on an {@link ArtifactError}, whose
 * `retryable` says when asking again later may work):
 *
 * - `server_not_connected`: no connector by that name, or it could not be
 *   started or reached;
 * - `needs_reauth`: the connector refused its credentials (HTTP 401/403);
 * - `not_granted`: this viewer may not use connectors (only the owner may);
 * - `rate_limited`: the connector is busy (HTTP 429);
 * - `upstream_error`: the connector answered with a protocol error, failed,
 *   or did not answer in time;
 * - `tool_error`, `consent_required`, `selection_required`, `not_in_manifest`,
 *   `not_declared`, `capability_disabled`, `capability_removed`,
 *   `server_unavailable`, `response_too_large`: reserved for hosts that
 *   mediate connectors further; pages handle them.
 *
 * A tool that ran and failed is not an error: it resolves with `isError`.
 */
export type McpErrorCode =
  | 'server_not_connected'
  | 'needs_reauth'
  | 'not_granted'
  | 'not_declared'
  | 'not_in_manifest'
  | 'consent_required'
  | 'selection_required'
  | 'rate_limited'
  | 'upstream_error'
  | 'tool_error'
  | 'capability_disabled'
  | 'capability_removed'
  | 'server_unavailable'
  | 'response_too_large';

/** Every {@link McpErrorCode}. */
export const MCP_ERROR_CODES: readonly McpErrorCode[] = [
  'server_not_connected',
  'needs_reauth',
  'not_granted',
  'not_declared',
  'not_in_manifest',
  'consent_required',
  'selection_required',
  'rate_limited',
  'upstream_error',
  'tool_error',
  'capability_disabled',
  'capability_removed',
  'server_unavailable',
  'response_too_large',
];

/** One content item of a tool result (MCP `CallToolResult.content`). */
export type McpContent =
  | { type: 'text'; text: string; annotations?: JsonRecord; _meta?: JsonRecord }
  | { type: 'image'; data: string; mimeType: string; annotations?: JsonRecord; _meta?: JsonRecord }
  | { type: 'audio'; data: string; mimeType: string; annotations?: JsonRecord; _meta?: JsonRecord }
  | {
      type: 'resource';
      resource: { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: JsonRecord };
      annotations?: JsonRecord;
      _meta?: JsonRecord;
    }
  | { type: 'resource_link'; uri: string; name: string; title?: string; description?: string; mimeType?: string; annotations?: JsonRecord; _meta?: JsonRecord };

/** What a tool answered: the MCP `CallToolResult`, as the connector sent it. */
export interface McpToolResult {
  content: McpContent[];
  structuredContent?: JsonRecord;
  /** The tool ran and failed; `content` says why. */
  isError?: boolean;
  _meta?: JsonRecord;
}

/** One tool of a connector (MCP `Tool`, the fields pages use). */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  /** JSON Schema of the tool's arguments. */
  inputSchema?: JsonRecord;
}

/**
 * Where a connector stands: `connected` (it answered, `tools` lists its
 * tools), `needs_auth` (it refused its credentials), `error` (it could not
 * be started or reached), `disconnected` (turned off in the configuration).
 */
export type McpAuthStatus = 'connected' | 'needs_auth' | 'error' | 'disconnected';

/** One connector, as {@link McpCapability.listTools} lists it. */
export interface McpServerEntry {
  /** Its name in the configuration, what {@link McpCapability.callTool} takes. */
  server: string;
  kind: 'connector';
  authStatus: McpAuthStatus;
  /** Present when `connected`. */
  tools?: McpToolInfo[];
  /** Why it is not connected. */
  error?: string;
}

/** Options of {@link McpCapability.callTool}. */
export interface McpCallOptions {
  /** Cancels the call (it rejects with the signal's reason). */
  signal?: AbortSignal;
  /** Milliseconds before the call fails with a retryable `upstream_error`. Default 120 000, at most 600 000. */
  timeoutMs?: number;
}

/** Default and largest {@link McpCallOptions.timeoutMs}. */
export const MCP_CALL_TIMEOUT = { defaultMs: 120_000, maxMs: 600_000 } as const;

/**
 * The `mcp` capability: calls tools of the connectors (MCP servers) the
 * owner configured on their computer. Only the owner gets it.
 */
export interface McpCapability {
  /** Calls `tool` of connector `server`; rejects with an {@link McpErrorCode} (see there). */
  callTool(server: string, tool: string, args: Record<string, unknown>, options?: McpCallOptions): Promise<McpToolResult>;
  /** Every connector (or only `server`) and, for those connected, their tools. */
  listTools(server?: string): Promise<{ servers: McpServerEntry[] }>;
}

/* -------------------------------------------------------------------------- */
/* sheet: a workbook kept as an edit log                                       */
/* -------------------------------------------------------------------------- */

/**
 * The `sheet` capability, granted to types whose manifest declares
 * `store: "workbook"`. The page runs its own workbook engine and keeps it in
 * step with the server's edit log: it loads the log with `read`, hears every
 * later edit with `onFrame`, and saves its own with `send`.
 */
export interface SheetCapability {
  read<K extends SheetReadRequest['kind']>(request: Extract<SheetReadRequest, { kind: K }>): Promise<SheetReadAnswers[K] | SheetReadRefusal>;
  send(request: SheetSendRequest): Promise<SheetSendResponse>;
  widget(request: WidgetRequest): Promise<WidgetResponse>;
  /** Keeps a file for the agent to bring in (Import from Excel) and asks it to. */
  importFile(file: Blob, name: string): Promise<ImportFileResponse>;
  /** Subscribes to the stream's frames: a snapshot first on every (re)connect, then edits, clocks and widgets. */
  onFrame(listener: (frame: SheetFrame) => void): () => void;
  /**
   * Subscribes to the walkthroughs the agent sends the person. Only one page of the owner's hears each, the one
   * they used last; guests hear none. A walkthrough sent while no listener is attached is not kept here.
   */
  onWalkthrough(listener: (walkthrough: SheetWalkthrough) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* The map                                                                    */
/* -------------------------------------------------------------------------- */

/** Every capability by name. */
export interface CapabilityMap {
  artifact: ArtifactCapability;
  assets: AssetsCapability;
  user: UserCapability;
  agent: AgentCapability;
  room: RoomCapability;
  downloads: DownloadsCapability;
  db: DbCapability;
  comments: CommentsCapability;
  history: HistoryCapability;
  doc: DocCapability;
  mcp: McpCapability;
  sheet: SheetCapability;
}

export type CapabilityName = keyof CapabilityMap;

/** The object installed at `window.openartifact`. */
export interface OpenArtifactRuntime {
  /** Contract version, see {@link CONTRACT_VERSION}. */
  readonly version: string;
  /**
   * Resolves the namespace of a capability, or `null` when this view may not
   * use it. Results are memoized and frozen.
   */
  use<K extends CapabilityName>(name: K): Promise<CapabilityMap[K] | null>;
}

declare global {
  interface Window {
    openartifact?: OpenArtifactRuntime;
  }
}
