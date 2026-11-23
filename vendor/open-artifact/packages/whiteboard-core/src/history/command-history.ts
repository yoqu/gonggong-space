/**
 * Undo and redo: a stack of steps, a wrapper that announces what happened
 * (for screen readers and toasts), and a hook a step uses to say something
 * other than "Undone".
 */

/** One undoable step. */
export interface HistoryStep {
  /** What the step did (`move`, `paste`, …); shown and announced by the UI. */
  label?: string;
  do(): void;
  undo(): void;
  /** `false` blocks redo (and {@link CommandHistory.exec}). */
  canDo?(): boolean;
  /** `false` blocks undo. */
  canUndo?(): boolean;
}

/** An undo stack. */
export interface CommandHistory {
  /** Runs a step and records it (unless `canDo` says no). */
  exec(step: HistoryStep): void;
  /** Records a step already applied. */
  seed(step: HistoryStep): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Steps on the redo stack. */
  redoDepth(): number;
  clear(): void;
  /** Steps recorded after `step`, or `undefined` when it is not on the undo stack. */
  above(step: HistoryStep): HistoryStep[] | undefined;
  /** The redo stack, oldest first. */
  waiting(): HistoryStep[];
  /** Removes `step` when it is the latest and nothing waits to be redone. */
  drop(step: HistoryStep): boolean;
  subscribe(listener: () => void): () => void;
}

/** Steps kept, at most. */
export const HISTORY_LIMIT = 200;

/** Creates an undo stack holding at most `limit` steps. */
export function createCommandHistory(limit = HISTORY_LIMIT): CommandHistory {
  const done: HistoryStep[] = [];
  const undone: HistoryStep[] = [];
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const record = (step: HistoryStep): void => {
    done.push(step);
    if (done.length > limit) done.shift();
    undone.length = 0;
    notify();
  };
  return {
    exec(step) {
      if (step.canDo?.() === false) return;
      step.do();
      record(step);
    },
    seed: record,
    undo() {
      const step = done.at(-1);
      if (step === undefined || step.canUndo?.() === false) return;
      done.pop();
      step.undo();
      undone.push(step);
      notify();
    },
    redo() {
      const step = undone.at(-1);
      if (step === undefined || step.canDo?.() === false) return;
      undone.pop();
      step.do();
      done.push(step);
      notify();
    },
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
    redoDepth: () => undone.length,
    clear() {
      if (done.length === 0 && undone.length === 0) return;
      done.length = 0;
      undone.length = 0;
      notify();
    },
    above(step) {
      const index = done.lastIndexOf(step);
      return index < 0 ? undefined : done.slice(index + 1);
    },
    waiting: () => [...undone],
    drop(step) {
      if (done.at(-1) !== step || undone.length > 0) return false;
      done.pop();
      notify();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** What the announced history says. */
export const HISTORY_MESSAGES = {
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  undone: 'Undone.',
  redone: 'Redone.',
} as const;

/** The label of a step that applied the agent's answer. */
export const AGENT_STEP_LABEL = 'The agent’s answer';

/** The part of {@link CommandHistory} the announced wrapper exposes. */
export interface AnnouncedHistory {
  exec(step: HistoryStep): void;
  seed(step: HistoryStep): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  redoDepth(): number;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

/** Wraps a history so undo and redo announce what happened (or that nothing could). */
export function createAnnouncedHistory(history: CommandHistory, announce: (message: string) => void): AnnouncedHistory {
  return {
    exec: (step) => history.exec(step),
    seed: (step) => history.seed(step),
    undo() {
      if (!history.canUndo()) return announce(HISTORY_MESSAGES.nothingToUndo);
      const depth = history.redoDepth();
      history.undo();
      if (history.redoDepth() === depth + 1) announce(HISTORY_MESSAGES.undone);
    },
    redo() {
      if (!history.canRedo()) return announce(HISTORY_MESSAGES.nothingToRedo);
      const depth = history.redoDepth();
      history.redo();
      if (history.redoDepth() === depth - 1) announce(HISTORY_MESSAGES.redone);
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    redoDepth: () => history.redoDepth(),
    clear: () => history.clear(),
    subscribe: (listener) => history.subscribe(listener),
  };
}

/** An announced history that also exposes the raw stack. */
export interface StepSaysHistory extends AnnouncedHistory {
  drop(step: HistoryStep): boolean;
  above(step: HistoryStep): HistoryStep[] | undefined;
  waiting(): HistoryStep[];
  /** The raw history: undo and redo without announcements. */
  silent: CommandHistory;
}

/**
 * An announced history where the running step may replace the announcement:
 * a step calls `stepSays(words)` during its `do`/`undo` to say `words`
 * instead (or `null` to say nothing).
 */
export function createStepSaysUndo(history: CommandHistory, say: (message: string) => void): { undo: StepSaysHistory; stepSays(words: string | null): void } {
  let override: string | null | undefined;
  const announced = createAnnouncedHistory(history, (words) => {
    if (override === undefined) say(words);
    else if (override !== null) say(override);
  });
  const run = (action: () => void): void => {
    override = undefined;
    try {
      action();
    } finally {
      override = undefined;
    }
  };
  return {
    undo: {
      ...announced,
      undo: () => run(announced.undo),
      redo: () => run(announced.redo),
      drop: (step) => history.drop(step),
      above: (step) => history.above(step),
      waiting: () => history.waiting(),
      silent: history,
    },
    stepSays(words) {
      override = words;
    },
  };
}
