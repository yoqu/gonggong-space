/**
 * Editor-agnostic version-history plumbing: reporting the history to a
 * Shell, answering its `history` command, following who may restore, and
 * reading a version's files a few at a time.
 *
 * Everything here takes the capability and callbacks as parameters (no
 * editor stores), so any editor can wire its own panel and preview to it.
 */

import type { ChromeCommand, HistoryCapability } from '@open-artifact/runtime';

/** What {@link wireVersionHistory} connects. */
export interface VersionHistoryWiring {
  history: Pick<HistoryCapability, 'list' | 'onChange'>;
  /** The viewer's role may restore (owner or editor); the host's listing has the last word. */
  roleMayRestore: boolean;
  /** Sets part of the Shell report (`{history: true}` on start, `{history: undefined}` on stop). */
  report(part: { history?: boolean }): void;
  /** Adds a Shell command handler; returns its remover. */
  onCommand(handler: (command: ChromeCommand) => void): () => void;
  /** Opens or closes the history panel (the Shell's History button). */
  toggle(): void;
  /** Whether this viewer may restore now. */
  setCanRestore(can: boolean): void;
}

/** Connects a history capability to a page and its Shell. Returns a stop function. */
export function wireVersionHistory(wiring: VersionHistoryWiring): () => void {
  let stopped = false;
  wiring.setCanRestore(wiring.roleMayRestore);
  wiring.report({ history: true });
  const refresh = (): void => {
    wiring.history.list().then(
      (listing) => {
        if (!stopped) wiring.setCanRestore(listing.canRestore && wiring.roleMayRestore);
      },
      () => undefined,
    );
  };
  refresh();
  const stops = [
    wiring.history.onChange(refresh),
    wiring.onCommand((command) => {
      if (command.cmd === 'history') wiring.toggle();
    }),
  ];
  return () => {
    stopped = true;
    for (const stop of stops) stop();
    wiring.report({ history: undefined });
  };
}

/**
 * Reads the paths of version `n` that `wanted` keeps, `workers` at a time,
 * as `[path, text]` pairs (unreadable paths are left out).
 */
export async function readVersionFiles(
  history: Pick<HistoryCapability, 'files' | 'read'>,
  n: number,
  wanted: (paths: string[]) => string[],
  workers = 12,
): Promise<Array<readonly [string, string]>> {
  const paths = wanted(Object.keys(await history.files(n)));
  const texts: Array<readonly [string, string]> = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const path = paths[next++]!;
      const text = await history.read(n, path).catch(() => null);
      if (text !== null) texts.push([path, text]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, paths.length) }, worker));
  return texts;
}
