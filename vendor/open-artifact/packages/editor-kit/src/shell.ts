/**
 * The bridge to an Open Artifact Shell framing the page.
 *
 * The Shell draws the shared top bar (save state, comments, export, Ask)
 * from one report the page sends whole. An editor builds that report one of
 * two ways:
 *
 * - from one function that reads every store: {@link chromeReporter} sends
 *   it only when it changed (Design, Slides, Design System);
 * - from parts different services own (sync owns `saved`, collaboration
 *   owns `comments`, export owns `formats`): {@link createShellBridge}
 *   merges the parts, sends one report per microtask and fans the Shell's
 *   commands out to every handler (Whiteboard).
 *
 * Outside a Shell every call is a no-op. Pure (no DOM).
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { ChromeCommand, ChromeDraw, ChromeExportItem, ChromeReport, ShellConnection } from '@open-artifact/runtime';

/** The agent part of a report, from the agent status every editor watches. */
export function agentChrome(status: { available: boolean; busy: boolean }): NonNullable<ChromeReport['agent']> {
  return { available: status.available, listening: status.available, busy: status.busy };
}

/**
 * A function that builds the report with `build` and sends it to `shell`
 * when it differs from the last one sent.
 */
export function chromeReporter(shell: ShellConnection, build: () => ChromeReport): () => void {
  let last = '';
  return () => {
    const next = build();
    const text = JSON.stringify(next);
    if (text === last) return;
    last = text;
    shell.report(next);
  };
}

/** What the Shell draws for the page (empty outside a Shell). */
export interface ShellDrawsState {
  draws: ReadonlySet<ChromeDraw>;
  /** A Shell frames this page. */
  framed: boolean;
}

/**
 * A handler of Shell commands; may answer an `exports` request with items.
 * Every command reaches every handler, `follow` too (sent where the report
 * has `following`, with a key from its `peers` or `null` to stop).
 */
export type ShellCommandHandler = (command: ChromeCommand) => ChromeExportItem[] | void;

/** A bridge made by {@link createShellBridge}. */
export interface ShellBridge {
  /** What the Shell draws for this page; components hide their own copy of what it draws. */
  useShellDraws: UseBoundStore<StoreApi<ShellDrawsState>>;
  /**
   * Sets parts of the report (keys set to `undefined` are removed) and sends
   * the merged report on the next microtask.
   */
  setShellReport(part: Partial<ChromeReport>): void;
  /** Adds a Shell command handler; returns a function that removes it. The first handler that returns export items answers an `exports` request. */
  onShellCommand(handler: ShellCommandHandler): () => void;
  /**
   * Connects to the Shell, if one frames the page: tracks what it draws,
   * dispatches its commands and tells it the page merges file changes live
   * (so it never reloads the frame under the viewer). Returns a stop function.
   */
  startShell(): () => void;
}

/** A report-by-parts bridge; `shell` reads the connection (`null` outside a Shell or before the session started). */
export function createShellBridge(shell: () => ShellConnection | null | undefined): ShellBridge {
  const useShellDraws = create<ShellDrawsState>()(() => ({ draws: new Set(), framed: false }));
  let report: ChromeReport = {};
  let scheduled = false;
  const handlers = new Set<ShellCommandHandler>();

  function send(): void {
    scheduled = false;
    shell()?.report(report);
  }

  function setShellReport(part: Partial<ChromeReport>): void {
    const next: ChromeReport = { ...report };
    let changed = false;
    for (const [key, value] of Object.entries(part) as Array<[keyof ChromeReport, ChromeReport[keyof ChromeReport]]>) {
      if (JSON.stringify(next[key]) === JSON.stringify(value)) continue;
      changed = true;
      if (value === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    if (!changed) return;
    report = next;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(send);
    }
  }

  function onShellCommand(handler: ShellCommandHandler): () => void {
    handlers.add(handler);
    return () => void handlers.delete(handler);
  }

  function startShell(): () => void {
    const connection = shell();
    if (!connection) return () => {};
    useShellDraws.setState({ draws: connection.draws, framed: true });
    const stops = [
      connection.onHello((draws) => useShellDraws.setState({ draws })),
      connection.onCommand((command) => {
        let answer: ChromeExportItem[] | undefined;
        for (const handler of [...handlers]) {
          const result = handler(command);
          if (answer === undefined && Array.isArray(result)) answer = result;
        }
        return answer ?? (command.cmd === 'exports' ? [] : undefined);
      }),
      connection.onFilesChanged(() => true),
    ];
    send();
    return () => {
      for (const stop of stops) stop();
    };
  }

  return { useShellDraws, setShellReport, onShellCommand, startShell };
}
