/**
 * Small React hooks shared by the chrome.
 */

import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type FocusEvent, type RefObject } from 'react';
import { shouldRefocus } from '../lib/refocus.ts';

function mediaStore(query: string) {
  return {
    subscribe(listener: () => void) {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    get(): boolean {
      return window.matchMedia(query).matches;
    },
  };
}

const coarse = mediaStore('(pointer: coarse)');

/** True on a touch-first device: controls grow to finger size. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(coarse.subscribe, coarse.get, () => false);
}

const narrowTouch = mediaStore('(pointer: coarse) and (max-width: 599px)');

/**
 * True on a touch-first phone-sized screen: the tool bar regroups tools
 * for it (the section moves into the Shapes tray). Larger tablets keep the
 * desktop grouping.
 */
export function useNarrowTouch(): boolean {
  return useSyncExternalStore(narrowTouch.subscribe, narrowTouch.get, () => false);
}

/** True while a media query matches. */
export function useMediaQuery(query: string): boolean {
  const store = useMemo(() => mediaStore(query), [query]);
  return useSyncExternalStore(store.subscribe, store.get, () => false);
}

/** Focus handlers {@link useFocusThroughDisable} needs on its field. */
export interface FocusThroughDisableProps<T extends HTMLInputElement | HTMLTextAreaElement> {
  onFocus: () => void;
  onBlur: (event: FocusEvent<T>) => void;
}

/**
 * A field that had focus when it was disabled takes it back when it is
 * enabled again within a few seconds, unless focus went somewhere else
 * meanwhile. Spread the returned handlers on the field.
 */
export function useFocusThroughDisable<T extends HTMLInputElement | HTMLTextAreaElement>(field: RefObject<T | null>, disabled: boolean): FocusThroughDisableProps<T> {
  const focused = useRef(false);
  const lostAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    const doc = element.ownerDocument;
    if (disabled) {
      lostAt.current = focused.current || doc.activeElement === element ? Date.now() : null;
      return;
    }
    const idle = doc.activeElement === null || doc.activeElement === doc.body;
    if (shouldRefocus(lostAt.current, Date.now(), idle)) element.focus();
    lostAt.current = null;
  }, [disabled, field]);
  return {
    onFocus: () => {
      focused.current = true;
    },
    onBlur: (event) => {
      // Being disabled blurs the field too; that blur keeps the claim to focus.
      if (!event.currentTarget.disabled) focused.current = false;
    },
  };
}
