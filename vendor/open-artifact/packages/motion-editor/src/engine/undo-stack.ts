/** A change made by hand that can be taken back: `undo` and `redo` each write the record as it was or will be. */
export interface UndoEntry {
  label: string;
  undo(): void;
  redo(): void;
}

export const MAX_UNDO = 100;

/** The page's undo history: a new change clears what could be redone. Pure. */
export class UndoStack {
  #done: UndoEntry[] = [];
  #undone: UndoEntry[] = [];
  readonly #max: number;

  constructor(max = MAX_UNDO) {
    this.#max = max;
  }

  push(entry: UndoEntry): void {
    this.#done.push(entry);
    if (this.#done.length > this.#max) this.#done.shift();
    this.#undone = [];
  }

  get canUndo(): boolean {
    return this.#done.length > 0;
  }

  get canRedo(): boolean {
    return this.#undone.length > 0;
  }

  /** Takes back the last change; its entry, or `null` when there is none. */
  undo(): UndoEntry | null {
    const entry = this.#done.pop();
    if (entry === undefined) return null;
    entry.undo();
    this.#undone.push(entry);
    return entry;
  }

  redo(): UndoEntry | null {
    const entry = this.#undone.pop();
    if (entry === undefined) return null;
    entry.redo();
    this.#done.push(entry);
    return entry;
  }

  clear(): void {
    this.#done = [];
    this.#undone = [];
  }
}
