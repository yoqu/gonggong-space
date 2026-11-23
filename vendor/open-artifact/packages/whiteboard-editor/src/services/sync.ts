/**
 * Live sync and undo: binds the board store to the live board document
 * over the session's `db` capability, and records this person's edits as
 * undo steps.
 *
 * - Local edits arrive through the board store's sink ({@link changeBoard}).
 *   Each becomes one step that records what changed field by field, so
 *   undoing a move never takes back someone else's text edit. Edits with
 *   the same gesture key merge into one step, including across pauses.
 *   Repeated keyboard edits and follow-up corrections merge in quick succession.
 * - The engine's snapshots flow back into the board store: the board, the
 *   save status, refusals and one-time notices (shown as toasts). Once the
 *   fonts have loaded, the board shown is fitted to them (text wraps widen
 *   to their longest word, shapes grow to fit overflowing text); the fitted
 *   sizes are stored with the next edit of the element.
 * - The agent answers by writing to the store. When this page asked the
 *   agent recently, the agent's writes become one step named
 *   {@link AGENT_STEP_LABEL}, so the person can take back the answer at once.
 * - The save state goes to the Shell (when one frames the page), and the
 *   page asks before closing with unsaved edits outside a Shell.
 * - A copy of the board as saved is kept on this device
 *   ({@link savedCopyCache}), so when the store cannot be reached at load
 *   the board still shows, and edits wait until it can.
 */

import { toast } from '@open-artifact/ui';
import type { ChromeCommand, ChromeReport } from '@open-artifact/runtime';
import {
  AGENT_STEP_LABEL,
  applyBoardDiff,
  createBoardStepCommitter,
  createCommandHistory,
  createFontFitContent,
  createLiveBoardDocument,
  createStepSaysUndo,
  createTableEditor,
  diffBoardContents,
  planSectionGrowth,
  sectionStillNeedsGrowth,
  type Board,
  type BoardContent,
  type BoardStepCommit,
  type ElementId,
  type HistoryStep,
  type LiveBoardDocument,
  type LiveSnapshot,
  type LiveCache,
  localStorageCache,
  type StepDocument,
  type SyncChangeEvent,
  type SyncTransport,
} from '@open-artifact/whiteboard-core';
import { setBoardSink, setBoardSnapshot, tellRemoteChange, useBoard, type ChangeOptions, type SyncStatus } from '../state/board.ts';
import { useHistory } from '../state/history.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { isGestureKey } from '../tools/gesture.ts';
import { askedRecently, useAgent } from './agent.ts';
import { installUndoHandler, redo, undo } from './commands.ts';
import { session } from './session.ts';
import { onShellCommand, setShellReport, useShellDraws } from './shell.ts';
import { flushTableCell, setTableEditor } from './table-edits.ts';

/** Longest pause between keyboard edits or follow-up corrections that still merge. */
export const COALESCE_WINDOW_MS = 1500;
/** The agent's writes count as an answer to this page when it asked within this long. */
export const AGENT_ANSWER_WINDOW_MS = 15 * 60 * 1000;
/** An answer ends after this long without agent writes (while the agent is not working). */
export const AGENT_ANSWER_QUIET_MS = 4000;

/** Options of {@link startSync}. */
export interface SyncOptions {
  /** Speaks a short message to screen readers (undo, redo, refusals). */
  announce?: (message: string) => void;
}

/** The running live board, for code that needs the document itself (exports, checks). */
let live: LiveBoardDocument | null = null;

/** The live board document, or `null` before sync started. */
export function liveBoard(): LiveBoardDocument | null {
  return live;
}

/**
 * The saved copy of this page's board in local storage, keyed by the page's
 * path. Too large a copy is dropped rather than kept stale; storage that is
 * unavailable (private windows, blocked site data) just means no copy.
 */
export function savedCopyCache(key = `wb-saved-copy:${location.pathname}`): LiveCache {
  return localStorageCache(key);
}

/** Board store status for an engine status. */
function storeStatus(snapshot: LiveSnapshot<Board>): SyncStatus {
  switch (snapshot.status) {
    case 'loading':
      return 'loading';
    case 'cached':
      return 'cached';
    case 'offline':
      return 'offline';
    case 'error':
      return 'error';
    default:
      return 'ready';
  }
}

/** The Shell's save badge for an engine status (`undefined` while loading). */
function shellSaved(snapshot: LiveSnapshot<Board>): ChromeReport['saved'] {
  switch (snapshot.status) {
    case 'ready':
      return 'saved';
    case 'dirty':
    case 'error':
      return 'unsaved';
    case 'saving':
      return 'saving';
    case 'offline':
    case 'cached':
      return 'reconnecting';
    case 'readonly':
      return 'readonly';
    default:
      return undefined;
  }
}

/** The element id a document path names (`elements/<id>`), if any. */
function elementIdOfPath(path: string): ElementId | undefined {
  const match = /^elements\/([^/]+)$/.exec(path);
  return match?.[1];
}

/** A coalescing step still open for merging. */
interface OpenStep {
  /** The run's coalesce key; `undefined` for a step only a follow-up joins. */
  key: string | undefined;
  label: string;
  /** The content before the first edit of the run. */
  start: BoardContent;
  /** The content after the last edit of the run. */
  end: BoardContent;
  step: HistoryStep;
  at: number;
}

/** The agent's answer being gathered into one step. */
interface AgentAnswer {
  /** The content before the agent's first write. */
  before: BoardContent;
  ids: Set<ElementId>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Starts syncing the board over the session's document store and installs
 * undo. Resolves nothing; the board store shows `loading` until the first
 * snapshot is in. Returns a function that flushes and stops.
 */
export function startSync(options: SyncOptions = {}): () => void {
  const { db, canEdit } = session();
  const announce = options.announce ?? (() => {});
  const stops: Array<() => void> = [];

  // ---- the agent's answers --------------------------------------------------------------------------------------

  // ---- the board as shown (fitted to the loaded fonts) -----------------------------------------------------------

  const fitContent = createFontFitContent();
  let fontsReady = false;
  let lastRaw: Board | undefined;
  let lastShown: Board | undefined;
  /** The document's board, fitted to the fonts once they have loaded. */
  const shown = (): Board => {
    const raw = doc.value();
    if (!fontsReady) return raw;
    if (raw === lastRaw && lastShown !== undefined) return lastShown;
    const content = fitContent(raw.content);
    lastRaw = raw;
    lastShown = content === raw.content ? raw : { title: raw.title, content };
    return lastShown;
  };

  let answer: AgentAnswer | null = null;
  let commit: BoardStepCommit | null = null;

  const closeAnswer = (): void => {
    const current = answer;
    if (!current || !commit) return;
    answer = null;
    if (current.timer !== undefined) clearTimeout(current.timer);
    const now = shown().content;
    if (current.ids.size > 0 && now !== current.before) commit(AGENT_STEP_LABEL, current.before, now, current.ids);
  };

  const armAnswerEnd = (): void => {
    if (!answer) return;
    if (answer.timer !== undefined) clearTimeout(answer.timer);
    answer.timer = setTimeout(() => {
      if (useAgent.getState().busy) armAnswerEnd();
      else closeAnswer();
    }, AGENT_ANSWER_QUIET_MS);
  };

  /** Called with an agent change before the engine applies it (the document still holds the content before). */
  const noteAgentChange = (event: SyncChangeEvent): void => {
    if (!canEdit || !askedRecently(AGENT_ANSWER_WINDOW_MS)) return;
    const ids = Object.keys(event.changes).flatMap((path) => elementIdOfPath(path) ?? []);
    if (ids.length === 0) return;
    answer ??= { before: shown().content, ids: new Set(), timer: undefined };
    for (const id of ids) answer.ids.add(id);
    armAnswerEnd();
  };

  stops.push(
    useAgent.subscribe((state, previous) => {
      if (previous.busy && !state.busy && answer) armAnswerEnd();
    }),
  );

  // ---- the document -----------------------------------------------------------------------------------------------

  const transport: SyncTransport = {
    get: (path) => db.get(path),
    list: (collection) => db.list(collection),
    // Paths come from the board codec, which only writes well-formed document paths.
    write: (writes) => db.write(writes as Parameters<typeof db.write>[0]),
    onChange: (listener) =>
      db.onChange((event) => {
        if (event.author === 'agent') noteAgentChange(event);
        listener(event);
      }),
  };
  const doc = createLiveBoardDocument({
    transport,
    cache: savedCopyCache(),
    readOnly: !canEdit,
    measures: currentMeasures,
    initial: useBoard.getState().board,
    formatTime: (epochMs) => new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  });
  live = doc;

  // ---- history ----------------------------------------------------------------------------------------------------

  const raw = createCommandHistory();
  const { undo: history } = createStepSaysUndo(raw, announce);
  let lastSeeded: HistoryStep | undefined;
  let refused = false;
  // Steps read and write the board as shown, so an edit's `before` is what the person saw.
  const stepDoc: StepDocument = { content: () => shown().content, setContent: (content) => doc.setContent(content) };
  commit = createBoardStepCommitter(
    stepDoc,
    {
      seed(step) {
        lastSeeded = step;
        history.seed(step);
      },
    },
    {
      onRefused(message) {
        refused = true;
        toast.add({ title: message });
        announce(message);
      },
      growth: {
        plan: (elements, changed) => planSectionGrowth(elements, changed, currentMeasures()),
        stillNeedsGrowth: (elements, section, height, moved) => sectionStillNeedsGrowth(elements, section, height, currentMeasures(), moved),
      },
    },
  );
  const commitStep = commit;

  let open: OpenStep | null = null;

  // Table content records steps of its own (board steps leave cells, rows and columns as the document has them).
  const tables = createTableEditor(stepDoc, history, {
    onRefused(message) {
      toast.add({ title: message });
      announce(message);
    },
  });
  /** Ends the open run and the agent's answer, so a table step lands after them. */
  const beforeTableEdit = (): void => {
    open = null;
    closeAnswer();
  };
  setTableEditor({
    has: tables.has,
    typeCell: (...args) => (beforeTableEdit(), tables.typeCell(...args)),
    setCell: (...args) => (beforeTableEdit(), tables.setCell(...args)),
    addRow: (...args) => (beforeTableEdit(), tables.addRow(...args)),
    addCol: (...args) => (beforeTableEdit(), tables.addCol(...args)),
    removeRow: (...args) => (beforeTableEdit(), tables.removeRow(...args)),
    removeCol: (...args) => (beforeTableEdit(), tables.removeCol(...args)),
    colWidth: (...args) => (beforeTableEdit(), tables.colWidth(...args)),
    fill: (...args) => (beforeTableEdit(), tables.fill(...args)),
    setFills: (...args) => (beforeTableEdit(), tables.setFills(...args)),
    setHeat: (...args) => (beforeTableEdit(), tables.setHeat(...args)),
  });
  stops.push(() => {
    flushTableCell();
    setTableEditor(null);
  });

  /**
   * Records a local edit as a step, merging it into the open run when the
   * key matches.
   *
   * The edit always applies as a step of its own first, against the
   * document as it is now. Only then do that step and the run's step become
   * one step from where the run started. (Committing straight from the
   * run's start would rebase the edit onto the document, and a table's
   * cells rebase to what the document holds, dropping the new text.)
   */
  const commitLocal = (before: BoardContent, after: BoardContent, change: ChangeOptions): void => {
    closeAnswer();
    const now = Date.now();
    const coalesce = change.coalesce;
    const sameKey = coalesce !== undefined && open?.key === coalesce;
    const joins = open !== null && (
      (sameKey && isGestureKey(coalesce)) ||
      (now - open.at <= COALESCE_WINDOW_MS && (sameKey || change.follows === true))
    );
    const run = joins ? open : null;
    const label = change.follows === true && run ? run.label : (change.label ?? 'Edit');
    const key = change.follows === true && run ? run.key : change.coalesce;
    lastSeeded = undefined;
    refused = false;
    if (!commitStep(label, before, after)) {
      if (!refused) doc.setContent(after);
      return;
    }
    open = null;
    let step = lastSeeded;
    let start = before;
    // Join the run only when its step is right below this one (nothing else was recorded between).
    if (run && step !== undefined && raw.above(run.step)?.length === 1 && raw.drop(step) && raw.drop(run.step)) {
      lastSeeded = undefined;
      // Keep remote changes that arrived between the two local edits out of the undo step.
      const intervening = run.end === before ? null : diffBoardContents(run.end, before);
      start = intervening ? applyBoardDiff(run.start, intervening, 'forward') : run.start;
      // `false`: the run ended where it began (dragged back), so it leaves no step.
      step = commitStep(label, start, stepDoc.content()) ? lastSeeded : undefined;
    }
    if (step !== undefined) open = { key, label, start, end: stepDoc.content(), step, at: now };
  };

  const publishHistory = (): void => {
    useHistory.setState({ canUndo: raw.canUndo(), canRedo: raw.canRedo(), undoLabel: undefined, redoLabel: raw.waiting().at(-1)?.label });
    setShellReport({
      actions: [
        { id: 'undo', disabled: !raw.canUndo() },
        { id: 'redo', disabled: !raw.canRedo() },
        { id: 'save_now', disabled: doc.getSnapshot().pending === 0 },
      ],
    });
  };
  stops.push(history.subscribe(publishHistory));
  stops.push(
    installUndoHandler({
      undo() {
        open = null;
        closeAnswer();
        flushTableCell();
        history.undo();
      },
      redo() {
        open = null;
        closeAnswer();
        history.redo();
      },
    }),
  );

  // ---- board store ⇄ document -------------------------------------------------------------------------------------

  let lastNotice = 0;
  const publish = (): void => {
    const snapshot = doc.getSnapshot();
    setBoardSnapshot(shown(), {
      status: storeStatus(snapshot),
      refusal: snapshot.refusal ?? null,
      pending: snapshot.pending,
      error: snapshot.loadState === 'failed' ? snapshot.message : null,
    });
    if (snapshot.notice && snapshot.notice.id !== lastNotice) {
      lastNotice = snapshot.notice.id;
      toast.add({ title: snapshot.notice.message });
    }
    setShellReport({
      saved: shellSaved(snapshot),
      leaveLosesWork: snapshot.pending > 0,
      hasContent: snapshot.value.content.elements.length > 0,
    });
    publishHistory();
  };
  stops.push(
    doc.subscribe((change) => {
      const previous = useBoard.getState().board;
      publish();
      if (change.remote && change.valueChanged) {
        const { board, byId } = useBoard.getState();
        useSelection.getState().prune((id) => byId.has(id));
        tellRemoteChange(board, previous);
      }
    }),
  );

  void document.fonts?.ready.then(() => {
    fontsReady = true;
    publish();
  });

  setBoardSink((next, previous, change) => {
    if (next.title !== previous.title) doc.setTitle(next.title);
    if (next.content !== previous.content) {
      if (change.history === false) doc.setContent(next.content);
      else commitLocal(previous.content, next.content, change);
    }
    // The document may have refused (loading, read-only, full) or normalized the edit.
    if (useBoard.getState().board !== shown()) publish();
  });
  stops.push(() => setBoardSink(null));
  publish();

  // ---- the Shell and leaving --------------------------------------------------------------------------------------

  stops.push(
    onShellCommand((command: ChromeCommand) => {
      if (command.cmd !== 'action') return;
      if (command.id === 'undo') undo();
      else if (command.id === 'redo') redo();
      else if (command.id === 'save_now') {
        doc.retry();
        void doc.flush();
      }
    }),
  );

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (doc.getSnapshot().pending === 0) return;
    void doc.flush();
    // A Shell asks before closing on its own (it has `leaveLosesWork`).
    if (!useShellDraws.getState().framed) event.preventDefault();
  };
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void doc.flush();
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onHide);
  stops.push(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onHide);
  });

  return () => {
    closeAnswer();
    for (const stop of stops.reverse()) stop();
    void doc.flush().finally(() => doc.dispose());
    if (live === doc) live = null;
  };
}

/** Retries a failed load or parked writes now (the status badge's retry). */
export function retrySync(): void {
  live?.retry();
}

/** Writes waiting edits now (a gesture ended: others should see where it landed soon). */
export function flushSync(): void {
  void live?.flush();
}
