/**
 * The contract between a Sheets page and its server (the `sheet` capability).
 *
 * The workbook is an edit log: revision n is the workbook after the first n
 * edits, each a list of engine operations written in a format version `v`
 * and made on revision `base`. A page keeps its own engine session in step
 * with the log: it reads a snapshot and loads the operations, hears every
 * later edit on the `sheet` event of `_api/events`, and sends its own edits
 * to `send`. Every new event connection gets a snapshot frame first, so a
 * page that reconnects learns how far the log moved meanwhile.
 *
 * Every route is relative to the artifact's page base, as the runtime's
 * `API` routes are.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** Route paths, relative to the page base. */
export const SHEET_API = {
  /** `POST` {@link SheetReadRequest} → the read's answer. */
  read: '_api/sheet/read',
  /** `POST` {@link SheetSendRequest} → {@link SheetSendResponse}. */
  send: '_api/sheet/send',
  /** `POST` {@link WidgetRequest} → {@link WidgetResponse}. */
  widget: '_api/sheet/widget',
  /** `POST` a file's bytes (`?name=`), kept for the agent to import → {@link ImportFileResponse}. */
  importFile: '_api/sheet/import',
} as const;

/** The server-sent event name the frames arrive under on `_api/events`. */
export const SHEET_EVENT = 'sheet';

/**
 * The server-sent event a walkthrough arrives under on `_api/events`. The agent sends one with the read
 * `{"kind": "showGuide", "guide": {"stops": […]}}`; the server gives it to one page of the owner's, the one they used
 * last, and to no one else.
 */
export const SHEET_WALKTHROUGH_EVENT = 'sheetWalkthrough';

/**
 * One stop of a walkthrough: `at` is a cell link, the part of the page's address after `#` (`sheet-<sheetId>~A2-D2~B1`,
 * the `#` may lead), and `say` is plain text, what the page shows beside those cells.
 */
export type WalkthroughStop = { at: string; say: string };

/** A walkthrough: 1 to 30 stops, which the page steps the person through in order. A new one replaces the last. */
export type SheetWalkthrough = { stops: WalkthroughStop[] };

/** Who made an edit, as pages show them. */
export type EditActor = {
  /** The id the engine knows the person by (`u_` and 22 letters and digits). */
  personId: string;
  /** True for the agent's edits (made for the owner). */
  isAgent: boolean;
};

/** A person as the page names them in cells (people chips) and history. */
export type SheetPerson = {
  personId: string;
  name: string;
  /** Present only for the owner and the people viewing now. */
  color?: string;
};

/** The first frame of a stream: where the log stands and who the page's person is. */
export type SnapshotFrame = {
  phase: 'snapshot';
  /** The workbook's id (a UUID). */
  workbookId: string;
  /** When the workbook was made, ISO 8601. */
  createdAt: string;
  revision: number;
  /** The newest format version the server takes. */
  newestFormatVersion: number;
  widgets: WidgetVersion[];
  viewer: { personId: string; canEdit: boolean };
};

/** An edit saved to the log (anyone's, the page's own among them). */
export interface EditFrame {
  phase: 'edit';
  revision: number;
  v: number;
  base: number;
  ops: Json[];
  actor: EditActor;
}

/** The clock, for `NOW()` and `TODAY()`: sent at the start, each minute and when the workbook's time zone changes. */
export interface ClockFrame {
  phase: 'clock';
  unixMilliseconds: number;
  utcOffsetInMinutes: number;
  timeZone: string | null;
}

/** A widget's code was published (its charts draw it again). */
export interface WidgetFrame {
  phase: 'widget';
  id: string;
  pub: number;
}

export type SheetFrame = SnapshotFrame | EditFrame | ClockFrame | WidgetFrame;

/** A widget and its published version. */
export type WidgetVersion = {
  id: string;
  pub: number;
};

/** `POST send`: one of the page's edits, as the engine recorded it. */
export interface SheetOpsRequest {
  opId: string;
  v: number;
  base: number;
  ops: Json[];
}

/**
 * `POST send`: edits a page asks the server to make on revision `base`, as the agent's are (a new workbook's first
 * sheet, its locale).
 */
export interface SheetEditsRequest {
  opId: string;
  base: number;
  edits: JsonObject[];
}

export type SheetSendRequest = SheetOpsRequest | SheetEditsRequest;

export type SheetSendResponse =
  | { kind: 'saved'; revision: number }
  /** `revision` is where the log stands, for an edits request whose base it is not. */
  | { kind: 'refused'; refusal: SendRefusal; revision?: number };

/**
 * Why a save is refused: the engine's refusal, or one of the store's own.
 * `changedSince` means the edit no longer applies on the edits made since its base.
 */
export type SendRefusal = 'changedSince' | 'pageIsBehind' | 'unknownFormatVersion' | 'unreadableEdit' | 'tooLarge' | 'notWriter' | (string & {});

/** The workbook's operations from a revision on, one page (the engine's `receiveLoadPage`). */
export type LoadPage = {
  kind: 'loadPage';
  from: number;
  revision: number;
  v: number;
  ops: Json[];
  next: number | null;
};

/** A version of the history pane: the edits from `firstRevision` to `revision`, newest first. */
export type VersionRow = {
  revision: number;
  firstRevision: number;
  /** When its last edit was made, ISO 8601. */
  at: string;
  authors: EditActor[];
};

/** Edits a page saves as one edit to take others back (restoring a version, undoing an agent's turn). */
export type EditsToTakeBack = {
  kind: 'editsToTakeBack';
  revision: number;
  edits: JsonObject[];
};

/** What a cell or a row held after an edit that changed it, newest first. */
export type CellHistoryRow = {
  revision: number;
  at: string;
  actor: EditActor;
  [held: string]: Json | EditActor;
};

export type CellHistory = {
  kind: 'cellHistory';
  rows: CellHistoryRow[];
  /** Earlier changes were left out. */
  truncated: boolean;
};

/** A revision range of edits, both ends included. */
export interface RevisionRange {
  first: number;
  last: number;
}

/** `POST read`: what the page asks the server. */
export type SheetReadRequest =
  | { kind: 'snapshot' }
  | { kind: 'load'; from?: number }
  | { kind: 'loadAtRevision'; revision: number }
  | { kind: 'versions'; limit?: number; before?: number }
  | { kind: 'editsThatRestore'; revision: number }
  | { kind: 'editsThatUndo'; ranges: RevisionRange[] }
  | { kind: 'cellHistory'; sheetId: string; r: string; c: string }
  | { kind: 'rowHistory'; sheetId: string; r: string }
  | { kind: 'people' }
  | { kind: 'sheets' }
  | { kind: 'xlsxCharts'; charts: JsonObject[] };

/** The answers to {@link SheetReadRequest}, by kind. */
export interface SheetReadAnswers {
  snapshot: SnapshotFrame;
  load: LoadPage;
  loadAtRevision: LoadPage;
  versions: { kind: 'versions'; rows: VersionRow[] };
  editsThatRestore: EditsToTakeBack;
  editsThatUndo: EditsToTakeBack;
  cellHistory: CellHistory;
  rowHistory: CellHistory;
  people: { kind: 'people'; people: SheetPerson[] };
  sheets: SheetsList;
  xlsxCharts: { kind: 'xlsxCharts'; descriptions: { viewId: string; description: JsonObject }[] };
}

/** The workbook's sheets as the engine lists them (`readSheets`), with its locale. */
export type SheetsList = {
  kind: 'sheets';
  revision: number;
  locale: string;
  sheets: JsonObject[];
};

/** A read the server turned away. */
export type SheetReadRefusal = {
  kind: 'refused';
  refusal: string;
};

/** `POST widget`: a chart widget's node. */
export type WidgetRequest =
  | { verb: 'create'; opId: string; code: string }
  | { verb: 'read'; id: string }
  | { verb: 'projection'; id: string }
  | { verb: 'draft'; id: string; basePub: number; code: string }
  | { verb: 'delete'; id: string };

export type WidgetState = {
  id: string;
  code: string;
  pub: number;
  /** Why the newest code is not published (it is staged), empty when it is. */
  errors: string[];
};

export type WidgetResponse =
  | { kind: 'widget'; widget: WidgetState }
  | { kind: 'projection'; id: string; module: string }
  | { kind: 'deleted' }
  | { kind: 'refused'; refusal: string; chartId?: string; pub?: number };

/** `POST importFile`: where the file was kept, and whether the agent was asked to import it. */
export interface ImportFileResponse {
  path: string;
  sentToAgent: boolean;
}
