/**
 * Loading the design systems an artifact installed (Design, Slides): each
 * copy lives under `project/ds/<folder>/`; its `tokens.json` is read,
 * normalized and handed to the editor, which turns it into what its menus
 * offer. The copies are read again when the installed list changes or a
 * `tokens.json` under `project/ds/` changes; an older read that finishes
 * late is dropped. Pure (no DOM).
 */

import { installedKey, normalizeTokens, type NormalizedTokens } from '@open-artifact/design-system-core';
import type { ArtifactCapability } from '@open-artifact/runtime';

/** Where installed systems live, as an artifact path. */
export const DS_DIR = 'project/ds/';

/** An installed copy as an artifact's index records it. */
export interface InstalledRecord {
  namespace: string;
  version?: string | null;
  copiedAt: string;
}

/** What one read of every copy found. */
export interface SystemsRead<S> {
  systems: S[];
  /** Namespaces whose copy could not be read (no tokens.json, or not JSON). */
  missing: string[];
}

/** What an editor supplies to {@link createSystemsLoader}. */
export interface SystemsLoaderAdapter<R extends InstalledRecord, S> {
  /** The artifact to read from (`null`: not connected yet, nothing is read). */
  artifact(): ArtifactCapability | null;
  /** The installed records now. */
  records(): readonly R[];
  /** Calls `listener` whenever the editor's document changes (the loader checks whether the records did). */
  subscribe(listener: () => void): unknown;
  /** Reads a copy's normalized tokens into what the editor offers. */
  read(record: R, tokens: NormalizedTokens): S;
  /** Stores a finished read. */
  loaded(result: SystemsRead<S>): void;
}

/** A loader made by {@link createSystemsLoader}. */
export interface SystemsLoader {
  /** Re-reads every copy now. */
  reload(): Promise<void>;
  /** Reads the copies and keeps them current. Later calls do nothing. */
  start(): void;
}

/** The loader of an editor's installed design systems. */
export function createSystemsLoader<R extends InstalledRecord, S>(adapter: SystemsLoaderAdapter<R, S>): SystemsLoader {
  let generation = 0;
  let started = false;

  async function reload(): Promise<void> {
    const artifact = adapter.artifact();
    if (!artifact) return;
    const run = ++generation;
    const records = adapter.records();
    const results = await Promise.all(
      records.map(async (record) => {
        const text = await artifact.readText(`${DS_DIR}${record.namespace}/tokens.json`).catch(() => null);
        if (text === null) return { record, system: null };
        try {
          return { record, system: adapter.read(record, normalizeTokens(JSON.parse(text)).tokens) };
        } catch {
          // Not JSON: the system offers nothing until it is fixed.
          return { record, system: null };
        }
      }),
    );
    if (run !== generation) return;
    adapter.loaded({
      systems: results.flatMap((r) => (r.system === null ? [] : [r.system])),
      missing: results.flatMap((r) => (r.system === null ? [r.record.namespace] : [])),
    });
  }

  function start(): void {
    const artifact = adapter.artifact();
    if (started || !artifact) return;
    started = true;
    void reload();
    let key = installedKey(adapter.records());
    adapter.subscribe(() => {
      const next = installedKey(adapter.records());
      if (next === key) return;
      key = next;
      void reload();
    });
    artifact.onChange((event) => {
      if (Object.keys(event.changes).some((path) => path.startsWith(DS_DIR) && path.endsWith('/tokens.json'))) void reload();
    });
  }

  return { reload, start };
}
