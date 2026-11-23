/**
 * The contract between a Docs page and its server (the `doc` capability).
 *
 * A doc is a list of tabs; each tab's body is a tree of blocks whose blocks
 * and characters carry stable ids (`<session>.<n>`), and a revision number
 * (`rev`) the server raises on every write. A page takes a writing session
 * (`session`), reads a tab (`read`), and sends its edits as ops on the
 * revision it holds (`call`, an `update` of the tab's body node). Every
 * write anyone makes is announced on the `doc` event of `_api/events`; a
 * page that did not make it reads the tab again.
 *
 * Every route is relative to the artifact's page base, as the runtime's
 * `API` routes are.
 */

export type DocJson = null | boolean | number | string | DocJson[] | { [key: string]: DocJson };
export type DocJsonObject = { [key: string]: DocJson };

/** Route paths, relative to the page base. */
export const DOC_API = {
  /** `POST` {@link DocSessionRequest} → {@link DocSessionResponse}. */
  session: '_api/doc/session',
  /** `POST` {@link DocReadRequest} → {@link DocTabResponse}. */
  read: '_api/doc/read',
  /** `POST` {@link DocCallRequest} → {@link DocCallAnswer}. */
  call: '_api/doc/call',
  /** `POST` {@link DocHistoryRequest} → {@link DocHistoryResponse}. */
  history: '_api/doc/history',
  /** `POST` {@link DocVersionRequest} → {@link DocVersionResponse}. */
  version: '_api/doc/version',
  /** `POST` {@link DocRestoreRequest} → {@link DocRestoreResponse}. */
  restore: '_api/doc/restore',
  /** `POST` a file's bytes (`?name=`, optional `&tabName=`) → {@link DocImportResponse}. */
  importFile: '_api/doc/import',
  /** `GET ?format=&tab=&paper=` → the file's bytes. */
  exportFile: '_api/doc/export',
} as const;

/** The server-sent event name the frames arrive under on `_api/events`. */
export const DOC_EVENT = 'doc';

/** The doc's export formats. */
export type DocExportFormat = 'markdown' | 'docx' | 'pdf' | 'html';

/** Paper sizes of a printed export. */
export type DocPaper = 'a4' | 'letter';

/** What the page asks of a dropdown list's option. */
export interface DocEnumOption {
  name: string;
  order: number;
  disabled: boolean;
  color?: string;
}

/** A dropdown list (a dropdown chip names its option by position). */
export interface DocEnum {
  id: string;
  name: string;
  options: DocEnumOption[];
}

/** A tab, as the doc lists it. */
export interface DocFile {
  id: string;
  name: string;
  /** Sort key: tabs are shown in the string order of these. */
  order: string;
  /** The tab this one sits under in the tab list. */
  subtabOf?: string;
  rev: number;
  /** The tab's body node: the page writes the tab through it. */
  content: { kind: 'node'; id: string; engine: 'prose' };
}

/** The doc: its name, tabs, dropdown lists and display record. */
export interface DocProject {
  id: string;
  name: string;
  /** Raised on every write anywhere in the doc. */
  head: number;
  updated: string;
  files: DocFile[];
  enums: DocEnum[];
  /** How the page shows the doc (fonts, page width, where the tabs go). The page owns the keys. */
  display?: DocJsonObject;
  /** Set while an owner has locked the doc: nobody can edit it until an owner unlocks it. */
  locked?: DocLockInfo;
}

/** Who locked a doc, when, and why. */
export interface DocLockInfo {
  by: { id: string; name: string };
  at: string;
  note?: string;
}

/** `POST session`: a writing session for this page connection (`client` is the event stream's id). */
export interface DocSessionRequest {
  client: string;
}

export interface DocSessionResponse {
  /** The writing session: new ids the page makes are `<sess>.<n>` from `next` on. `null` for a reader. */
  sess: string | null;
  next: number;
  writable: boolean;
  commentable: boolean;
  /** The person, as suggestions name them (`by`). */
  me: { id: string; name: string };
  project: DocProject;
  /** The names of the people who worked on the doc, by the id versions and suggestions name them with. */
  people?: Record<string, string>;
}

/** `POST read`: a tab as the server holds it. */
export interface DocReadRequest {
  tab: string;
}

/** Who made an open suggestion. */
export interface DocSuggestion {
  id: string;
  by: string;
  /** The name `by` goes by, when the doc knows it (not for the agent's). */
  name?: string;
  at: string;
  /** `agent`: the agent laid it. */
  via?: string;
  mine: boolean;
  /** A hash of what the suggestion holds now: a decision is made on it. */
  asOf: string;
}

export interface DocTabResponse {
  tab: string;
  rev: number;
  /** The tab's content as stored (`{rev, blocks, suggestions?}`, text kept as runs). */
  doc: DocJsonObject;
  suggestions: DocSuggestion[];
}

/** One member of a call: a verb on an object (`project`, `file`, `node`, `enum`). */
export interface DocMember {
  verb: 'read' | 'create' | 'update' | 'delete';
  object?: 'project' | 'file' | 'node' | 'enum';
  ref?: { object: 'project' | 'file' | 'node' | 'enum'; id: string };
  payload?: DocJsonObject;
  engine?: string;
  /** An alias later members name as `$lid:<alias>` for what this one makes. */
  $lid?: string;
}

/**
 * `POST call`: one member, or a batch that lands whole. `opId` makes a call
 * safe to send again (after a reconnect): an allowed call is answered again,
 * not run twice.
 */
export type DocCallRequest =
  | { sess: string; opId?: string; member: DocMember }
  | { sess: string; opId?: string; batch: DocMember[] };

export type DocCallAnswer =
  | ({ verdict: 'allow'; replayed?: true } & DocJsonObject)
  | {
      verdict: 'deny';
      /** A refusal code (`guard_mismatch`, `block_gone`, `not_your_session`, …). */
      reason: string;
      detail: string;
      /** The batch member, or the op of an update, that was refused. */
      index?: number;
      data?: DocJsonObject;
    };

/** A write somebody made to a tab. */
export interface DocTabFrame {
  kind: 'tab';
  tab: string;
  rev: number;
  by: 'person' | 'agent';
  /** The session that wrote it, and the page's own id for the call. */
  sess?: string;
  opId?: string;
  /** The blocks the write changed, added or removed (the agent's writes). */
  blocks?: string[];
}

/** The doc's name, tabs or display record changed. */
export interface DocProjectFrame {
  kind: 'project';
  project: DocProject;
}

/** Dropdown lists made or changed. */
export interface DocEnumsFrame {
  kind: 'enums';
  enums: DocEnum[];
}

/** The page's event stream opened: sent first on every connection, so a page that was cut off reads what it missed. */
export interface DocStreamFrame {
  kind: 'stream';
}

export type DocFrame = DocTabFrame | DocProjectFrame | DocEnumsFrame | DocStreamFrame;

/** `POST history`: a tab's kept versions. */
export interface DocHistoryRequest {
  tab: string;
}

/** A kept version of a tab. */
export interface DocVersion {
  rev: number;
  /** `human`: a person on the page; `agent`: the agent; `system`: from before the history began. */
  by: 'human' | 'agent' | 'system';
  /** The person's id. */
  user?: string;
  /** The name that person goes by, when the doc knows it. */
  name?: string;
  at: string;
  /** A restore: the rev it brought back. */
  restoredFrom?: number;
}

export interface DocHistoryResponse {
  tab: string;
  rev: number;
  /** Newest first. */
  versions: DocVersion[];
}

/** `POST version`: a tab as it stood at a kept rev. */
export interface DocVersionRequest {
  tab: string;
  rev: number;
}

export interface DocVersionResponse {
  tab: string;
  rev: number;
  /** As {@link DocTabResponse.doc}, without open suggestions. */
  doc: DocJsonObject;
}

/** `POST restore`: the tab back as it was at `rev`, as a new write; `ifRev` is the rev the page last saw. */
export interface DocRestoreRequest {
  tab: string;
  rev: number;
  ifRev?: number;
}

export interface DocRestoreResponse {
  restored: boolean;
  /** The tab's rev now, and before the restore. */
  rev: number;
  before: number;
}

/** The kinds of file an import reads. */
export type DocImportFormat = 'markdown' | 'docx' | 'pdf';

/** What didn't come across whole, counted: `what` says it in a few words, shown as it is. */
export interface DocImportNote {
  what: string;
  count: number;
}

/** What an import added. */
export interface DocImportResponse {
  ok: true;
  format: DocImportFormat;
  /** The new tabs, in order. */
  tabs: { id: string; name: string }[];
  /** The file's size. */
  bytes: number;
  /** How many pictures it brought. */
  images: number;
  notes: DocImportNote[];
  /** A doc made from the file, when the folder held none. */
  created?: { id: string; name: string; root: string };
}
