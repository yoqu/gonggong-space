import type { ConsoleLevel, ErrorPhase } from '../protocol.ts';
import { say } from './port.ts';

const LONGEST_LINE = 2000;
const LONGEST_MESSAGE = 600;
const LONGEST_STACK = 2000;

let phase: ErrorPhase = 'load';
let loadFailed = false;
let seen = new Set<string>();
/** Set while a script runs under tryScript: what it throws is kept for the caller instead of reported. */
let guard: { error: unknown } | null = null;
/** In a film made of scenes, who hears what deferred code throws while the film loads, instead of the film failing. */
let lateTo: ((error: unknown) => void) | null = null;

export const errorPhase = (): ErrorPhase => phase;
export function setErrorPhase(next: ErrorPhase): void {
  phase = next;
}
export const failedToLoad = (): boolean => loadFailed;
export function setLateHandler(handler: ((error: unknown) => void) | null): void {
  lateTo = handler;
}

/** A failure episode that ended: the next one is reported afresh. */
export function forgetErrors(): void {
  seen = new Set();
}

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message || 'error';
  return String(error ?? 'error');
};

export function reportError(at: ErrorPhase, error: unknown): void {
  const message = messageOf(error).slice(0, LONGEST_MESSAGE);
  const stack = (error instanceof Error ? (error.stack ?? '') : '').slice(0, LONGEST_STACK);
  const key = at + '|' + message;
  if (seen.has(key)) return;
  seen.add(key);
  say({ type: 'error', phase: at, message, stack });
}

/** Runs `run` and gives back what it threw through the window's error event, or null. Guards nest. */
export function guarded(run: () => void): unknown {
  const outer = guard;
  const mine = { error: null as unknown };
  guard = mine;
  try {
    run();
  } finally {
    guard = outer;
  }
  return mine.error;
}

function shown(part: unknown): string {
  try {
    if (part instanceof Error) return String(part.stack || part.message || part);
    if (typeof part === 'object') return JSON.stringify(part);
    return String(part);
  } catch {
    return String(part);
  }
}

/** Console lines go to the host as well, which shows them; the film's errors fail a check. */
export function captureConsole(): void {
  const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...parts: unknown[]): void => {
      original(...parts);
      say({ type: 'console', level, text: parts.map(shown).join(' ').slice(0, LONGEST_LINE) });
    };
  }
}

export function catchErrors(): void {
  window.addEventListener('error', (event) => {
    const error: unknown = event.error ?? new Error(String(event.message));
    if (guard) {
      guard.error = error;
      event.preventDefault();
      return;
    }
    if (lateTo && phase === 'load') {
      lateTo(error);
      event.preventDefault();
      return;
    }
    if (phase === 'load') loadFailed = true;
    reportError(phase, event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (lateTo && phase === 'load') {
      lateTo(event.reason);
      event.preventDefault();
      return;
    }
    reportError(phase, event.reason);
  });
}
