/**
 * A file dropped where nothing takes it (a read-only canvas, panels, toolbars)
 * would make the browser open the file in place of the editor. This guard
 * swallows such drops; a handler that takes the drop has already prevented its
 * default, and an enabled file input keeps its own drop.
 */

/** Minimal shape of a drag event target, so the guard runs without a DOM. */
export interface FileDropTarget {
  readonly tagName?: string;
  readonly type?: string;
  readonly disabled?: boolean;
}

/** The parts of a drag event the guard reads. */
export interface FileDragEvent {
  readonly type: string;
  readonly defaultPrevented: boolean;
  readonly target?: EventTarget | FileDropTarget | null;
  readonly dataTransfer: { types: ArrayLike<string> | Iterable<string>; dropEffect: string } | null;
  composedPath?(): readonly unknown[];
  preventDefault(): void;
}

/** The parts of a window the guard listens on. */
export interface FileDropWindow {
  addEventListener(type: 'dragover' | 'drop', listener: (event: FileDragEvent) => void): void;
  removeEventListener(type: 'dragover' | 'drop', listener: (event: FileDragEvent) => void): void;
}

/** True when the drag carries files from outside the page. */
export function carriesFiles(event: FileDragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isEnabledFileInput(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const target = node as FileDropTarget;
  return typeof target.tagName === 'string' && target.tagName.toLowerCase() === 'input' && target.type === 'file' && target.disabled !== true;
}

function landsOnFileInput(event: FileDragEvent): boolean {
  const first = event.composedPath?.()[0] ?? event.target ?? null;
  return isEnabledFileInput(first);
}

/** Installs the guard; returns a function that removes it. */
export function guardFileDrops(win: FileDropWindow): () => void {
  const guard = (event: FileDragEvent): void => {
    if (event.defaultPrevented || !carriesFiles(event) || landsOnFileInput(event)) return;
    event.preventDefault();
    if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  win.addEventListener('dragover', guard);
  win.addEventListener('drop', guard);
  return () => {
    win.removeEventListener('dragover', guard);
    win.removeEventListener('drop', guard);
  };
}
