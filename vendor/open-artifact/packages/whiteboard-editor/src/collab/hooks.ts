/**
 * React hooks shared by the collaboration layers: a coarse clock, lists
 * that fade out instead of vanishing, this viewer's color (as kept among
 * the people online, `colors.ts`) and the claim frames as drawn.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Box } from '@open-artifact/whiteboard-core';
import { useBoard } from '../state/board.ts';
import { useMeasures } from '../state/measures.ts';
import { useAgentActivity } from './activity.ts';
import { WORKING_WORD_TURN_MS, nextWorkingWord } from './activity-labels.ts';
import { useAsks } from './asks.ts';
import { claimOwner, trackedClaimFrame, useClaims } from './claims.ts';
import { useOwnColor } from './colors.ts';
import { useCollabPeers } from './peers.ts';

/** The time now, refreshed every `everyMs`. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** An item of a fading list. */
export type Fading<T> = T & { leaving?: boolean };

/**
 * Keeps items that left `items` for `ms` more, marked `leaving`, so they
 * can fade out. Items are matched by `key`.
 */
export function useFading<T extends { key: string }>(items: readonly T[], ms: number): Array<Fading<T>> {
  const [leaving, setLeaving] = useState<ReadonlyMap<string, T>>(new Map());
  const previous = useRef<ReadonlyMap<string, T>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const now = new Map(items.map((item) => [item.key, item]));
    const gone = [...previous.current].filter(([key]) => !now.has(key));
    const back = [...now.keys()].filter((key) => timers.current.has(key));
    previous.current = now;
    for (const key of back) {
      clearTimeout(timers.current.get(key));
      timers.current.delete(key);
    }
    if (gone.length === 0 && back.length === 0) return;
    setLeaving((current) => {
      const next = new Map(current);
      for (const key of back) next.delete(key);
      for (const [key, item] of gone) next.set(key, item);
      return next;
    });
    for (const [key] of gone) {
      clearTimeout(timers.current.get(key));
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          setLeaving((current) => {
            const next = new Map(current);
            next.delete(key);
            return next;
          });
        }, ms),
      );
    }
  }, [items, ms]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  return useMemo(() => [...items, ...[...leaving.values()].map((item) => ({ ...item, leaving: true }))], [items, leaving]);
}

/** This viewer's color: the one this page settled on among the people online. */
export function useMyColor(): string {
  return useOwnColor((state) => state.color);
}

/** A working word ("Pondering") that changes every few seconds while `on`. */
export function useWorkingWord(on: boolean): string {
  const [word, setWord] = useState(() => nextWorkingWord(undefined));
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setWord((previous) => nextWorkingWord(previous)), WORKING_WORD_TURN_MS);
    return () => clearInterval(timer);
  }, [on]);
  return word;
}

/** A claim as drawn. */
export interface ClaimView {
  key: string;
  /** Board units, padded. */
  frame: Box;
  color: string;
  /** Requested from this page. */
  mine: boolean;
  /** The asker, for someone else's request. */
  name?: string;
  /** What the agent is doing there ("Writing"). */
  label: string;
}

/** The claims to frame now (those not framed, such as idle ones, left out). */
export function useClaimViews(): ClaimView[] {
  const claimed = useBoard((state) => state.board.content.claimed);
  const elements = useBoard((state) => state.board.content.elements);
  const measures = useMeasures((state) => state.measures);
  const track = useClaims((state) => state.track);
  const asks = useAsks((state) => state.asks);
  const tabKey = useAsks((state) => state.tabKey);
  const peers = useCollabPeers((state) => state.peers);
  const activity = useAgentActivity((state) => state.label);
  const myColor = useMyColor();
  const working = useWorkingWord((claimed?.length ?? 0) > 0);
  return useMemo(() => {
    const views: ClaimView[] = [];
    for (const [key, tracked] of track.claims) {
      if (!tracked.framed) continue;
      const frame = trackedClaimFrame(tracked, elements, measures);
      if (!frame) continue;
      const owner = claimOwner(key, asks, tabKey, myColor, peers);
      views.push({ key, frame, color: owner.color, mine: owner.mine, ...(owner.name ? { name: owner.name } : {}), label: owner.activity ?? activity ?? working });
    }
    return views;
  }, [track, elements, measures, asks, tabKey, peers, activity, myColor, working]);
}
