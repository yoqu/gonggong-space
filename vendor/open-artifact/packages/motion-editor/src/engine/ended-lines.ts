/**
 * Finds the lines typed by hand that an agent's turn stopped showing (it rewrote the text round them): the film's
 * text sites are kept as they stood before the turn, and the first change the turn brings is compared with them.
 * Pure: the caller says when the film or the agent's activity changed, and what time it is.
 */

import {
  ENDED_LINES_WINDOW_MS,
  filmSources,
  findEndedRetypedLines,
  scanTextSites,
  snapshotRetypedSites,
  type EndedRetypedLine,
  type Film,
  type RetypedLine,
  type StoodRetypedSites,
} from '@open-artifact/motion-core';

/** What the watcher reads of the film: its code and the retyped lines. */
export interface WatchedFilm {
  film: Pick<Film, 'script' | 'modules'>;
  lines: readonly RetypedLine[];
}

/** The film's code as one string, to tell a change from none. */
export function filmTextKey(film: Pick<Film, 'script' | 'modules'>): string {
  return [film.script, ...film.modules.map((module) => `${module.name}\u0000${module.text}`)].join('\u0001');
}

export class EndedLinesWatch {
  #stood: { key: string; sites: StoodRetypedSites } | null = null;
  #working = false;
  #turnStartedAt: number | null = null;
  #turnEndedAt: number | null = null;
  #changedAt: number | null = null;
  readonly #windowMs: number;

  constructor(windowMs = ENDED_LINES_WINDOW_MS) {
    this.#windowMs = windowMs;
  }

  /** The agent started or ended a turn. */
  activity(working: boolean, now: number): void {
    if (!this.#working && working) this.#turnStartedAt = now;
    if (this.#working && !working) this.#turnEndedAt = now;
    this.#working = working;
  }

  /**
   * The film as it is now; gives the lines the last turn ended, or none. While the agent works the sites stay as they
   * stood before the turn.
   */
  film(watched: WatchedFilm | null, now: number): EndedRetypedLine[] {
    if (watched === null) return [];
    const key = filmTextKey(watched.film);
    const changed = this.#stood !== null && this.#stood.key !== key;
    if (changed) this.#changedAt ??= now;
    if (this.#working && this.#stood !== null) return [];
    let ended: EndedRetypedLine[] = [];
    if (changed && this.#stood !== null) {
      const changedAt = this.#changedAt;
      if (
        this.#turnStartedAt !== null &&
        this.#turnEndedAt !== null &&
        changedAt !== null &&
        changedAt >= this.#turnStartedAt &&
        changedAt - this.#turnEndedAt <= this.#windowMs &&
        watched.lines.length > 0
      ) {
        const sources = filmSources(watched.film);
        ended = findEndedRetypedLines(this.#stood.sites, sources, scanTextSites(sources), watched.lines);
      }
      this.#turnEndedAt = null;
    }
    this.#changedAt = null;
    if (this.#stood === null || this.#stood.key !== key) {
      const sources = filmSources(watched.film);
      this.#stood = { key, sites: snapshotRetypedSites(sources, scanTextSites(sources).sites, watched.lines) };
    }
    return ended;
  }
}
