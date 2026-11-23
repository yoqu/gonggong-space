/**
 * Which slide thumbnails run live, and snapshots for the rest.
 *
 * A thumbnail is a whole slide (a 1920×1080 tree of DOM) scaled down. A
 * 500-slide deck in the rail and the grid would mount over a thousand of
 * them. So only a few are live at a time:
 *
 * - the ones in or near their view (the rail's or the grid's scroll box, the
 *   canvas view's viewport) once it has been still for a moment, drawn large
 *   enough to read, at most `MAX_LIVE`, on screen and nearest the middle
 *   first;
 * - the ones the person works with: the current slide, the dragged ones, the
 *   hovered one.
 *
 * Every other thumbnail shows a snapshot, a small image of the slide
 * (services/snapshot.ts), or the slide's background color until it has one.
 * A snapshot is keyed by what the slide draws, the canvas size, the deck's
 * typefaces and how far they have loaded (services/live-plan.ts); when one of
 * them changes, the slide is captured again. Captures run in idle time, the
 * slides on screen and nearest them first, never while a view scrolls or
 * pans, a pointer is down or someone types.
 *
 * Only thumbnails rendered with `virtual` take part (rail, grid, canvas
 * tiles); their view is the nearest element marked `data-open-artifact-thumbs`. A view
 * that draws slides itself (the canvas engine) takes part as a snapshot
 * source: its slides get snapshots too, the ones it shows first.
 *
 * `?open_artifact_live=all` turns this off: every thumbnail is live, as before (for
 * comparing in benchmarks, and as a way out).
 *
 * Unlike the Design editor (whose snapshots come from artboard iframes), no
 * object here comes from another realm, so nothing pins a dead document.
 *
 * Stage S0 of docs/zh-CN/rust-wasm-core.md §11.
 */

import { create } from 'zustand';
import { SLIDE_WIDTH } from '@open-artifact/slides-core';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { lookKey, snapshotKey, wantedLive, captureOrder, type PlacedThumb, type Rect } from './live-plan.ts';
import { resolveSrc } from './session.ts';
import { snapshotSlide } from './snapshot.ts';

/** At most this many thumbnails are live for being on screen. */
export const MAX_LIVE = 32;
/** Fraction of a view's size, on every side, that counts as near. */
const NEAR_MARGIN = 0.5;
/** Thumbnails drawn narrower than this stay snapshots. */
const MIN_LIVE_WIDTH = 48;
/** A view counts as still after this long without scrolling or panning. */
const IDLE_MS = 150;
/** A slide is captured once it has not changed for this long. */
const SETTLE_MS = 400;
/** No capture this soon after a key press. */
const TYPING_MS = 1000;
/** Captures running at once. */
const CONCURRENCY = 2;
/** Snapshot pixels per slide px (a 1920-wide slide gives a 480-wide image). */
export const SNAPSHOT_SCALE = 0.25;

/** `?open_artifact_live=all`: every thumbnail live, no snapshots. */
export const liveAll = (() => {
  try {
    return new URLSearchParams(location.search).get('open_artifact_live') === 'all';
  } catch {
    return false;
  }
})();

export interface Snapshot {
  /** Object URL of the image. */
  url: string;
  /** The image itself (the canvas engine decodes it into a texture). */
  blob: Blob;
  /** What it was taken from (see {@link snapshotKey}). */
  key: string;
}

interface LiveState {
  /** Slides whose thumbnails are live. */
  live: ReadonlySet<string>;
  snapshots: Readonly<Record<string, Snapshot>>;
}

export const useLive = create<LiveState>(() => ({ live: new Set(), snapshots: {} }));

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

interface Registered {
  id: string;
  /** The element the thumbnail scrolls or pans in (null: the window). */
  view: HTMLElement | null;
}

/** Something that draws slides without a {@link SlideThumb} and wants their snapshots (the canvas engine). */
export interface SnapshotSource {
  /** The slides it draws. */
  ids(): Iterable<string>;
  /** Of those, the ones on screen (captured first). */
  visible(): Iterable<string>;
}

const thumbs = new Map<HTMLElement, Registered>();
const sources = new Set<SnapshotSource>();
let hovered: string | null = null;
let dragging: readonly string[] = [];

/**
 * Takes part in virtualization: the thumbnail box `el` shows slide `id`.
 * Returns the function that takes it out.
 */
export function registerThumb(el: HTMLElement, id: string): () => void {
  thumbs.set(el, { id, view: el.parentElement?.closest<HTMLElement>('[data-open-artifact-thumbs]') ?? null });
  engine().changed();
  return () => {
    thumbs.delete(el);
    if (hovered === id && ![...thumbs.values()].some((t) => t.id === id)) hovered = null;
    engine().changed();
  };
}

/**
 * Takes part in snapshots without thumbnail elements: `source`'s slides are
 * captured like those of registered thumbnails. Call {@link noteThumbsMoved}
 * while its view moves. Returns the function that takes it out.
 */
export function registerSnapshotSource(source: SnapshotSource): () => void {
  sources.add(source);
  engine().changed();
  return () => {
    sources.delete(source);
    engine().changed();
  };
}

/** The pointer entered (true) or left (false) a thumbnail. */
export function hoverThumb(id: string, on: boolean): void {
  const next = on ? id : hovered === id ? null : hovered;
  if (next === hovered) return;
  hovered = next;
  engine().changed();
}

/** Slides being dragged in the rail, grid or canvas (none: empty). */
export function setDraggedSlides(ids: readonly string[]): void {
  if (ids.length === dragging.length && ids.every((id, i) => dragging[i] === id)) return;
  dragging = ids;
  engine().changed();
}

/** A view of thumbnails moved without scrolling (the canvas view's camera). */
export function noteThumbsMoved(): void {
  engine().moved();
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                      */
/* -------------------------------------------------------------------------- */

interface Engine {
  /** Thumbnails, pins or layout changed: recompute soon (not mid-motion). */
  changed(): void;
  /** A view scrolled or panned. */
  moved(): void;
}

let running: Engine | null = null;

const engine = (): Engine => (running ??= start());

const noop: Engine = { changed() {}, moved() {} };

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

const requestIdle: (callback: () => void) => void =
  typeof requestIdleCallback === 'function' ? (callback) => requestIdleCallback(callback, { timeout: 1000 }) : (callback) => setTimeout(callback, 16);

function start(): Engine {
  if (liveAll || typeof window === 'undefined') return noop;
  let moving = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  let pumpQueued = false;
  let recomputeQueued = false;
  let pointerDown = false;
  let lastKeyAt = 0;
  let fontEpoch = 0;
  /** Slides on screen at the last recompute (captures start there). */
  let visible: ReadonlySet<string> = new Set();
  /** Slides being captured. */
  const capturing = new Set<string>();
  /** Key a slide could not be captured with: not tried again until it changes. */
  const failed = new Map<string, string>();
  /** When each slide last changed. */
  const changedAt = new Map<string, number>();
  const stats = { captures: 0, captureMs: 0, worstCaptureMs: 0, firstAt: 0, lastAt: 0 };
  /** Font faces (family, weight, style) seen loaded. */
  const loadedFaces = new Set<string>();

  const look = (): string => lookKey({ width: SLIDE_WIDTH, faces: useDeck.getState().index.faces, fontEpoch });

  const pinned = (idle: boolean): Set<string> => {
    const out = new Set<string>(dragging);
    const current = useView.getState().current;
    if (current) out.add(current);
    if (idle && hovered) out.add(hovered);
    return out;
  };

  const registeredIds = (): Set<string> => {
    const out = new Set<string>();
    for (const t of thumbs.values()) out.add(t.id);
    for (const source of sources) for (const id of source.ids()) out.add(id);
    return out;
  };

  const viewport = (): Rect => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };

  /** Applies the wanted set; while a view moves, only pins are added (nothing else mounts mid-motion). */
  const recompute = (): void => {
    recomputeQueued = false;
    const current = useLive.getState().live;
    const ids = registeredIds();
    let next: Set<string>;
    if (moving) {
      next = new Set([...current].filter((id) => ids.has(id)));
      for (const id of pinned(false)) next.add(id);
    } else {
      const views = new Map<HTMLElement | null, Rect>();
      const placed: PlacedThumb[] = [];
      for (const [el, t] of thumbs) {
        if (!el.isConnected) continue;
        let view = views.get(t.view);
        if (!view) {
          view = t.view ? rectOf(t.view) : viewport();
          views.set(t.view, view);
        }
        const rect = rectOf(el);
        if (rect.w === 0 && rect.h === 0) continue;
        placed.push({ id: t.id, rect, view });
      }
      const wanted = wantedLive(placed, pinned(true), { max: MAX_LIVE, margin: NEAR_MARGIN, minWidth: MIN_LIVE_WIDTH });
      next = wanted.live;
      const shown = new Set(wanted.visible);
      for (const source of sources) for (const id of source.visible()) shown.add(id);
      visible = shown;
    }
    if (!sameSet(current, next)) useLive.setState({ live: next });
    schedulePump(0);
  };

  /** Recompute before the next paint (a microtask: after React's commit, before the browser draws). */
  const queueRecompute = (): void => {
    if (recomputeQueued) return;
    recomputeQueued = true;
    queueMicrotask(recompute);
  };

  const moved = (): void => {
    moving = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      moving = false;
      queueRecompute();
    }, IDLE_MS);
  };

  const schedulePump = (ms: number): void => {
    if (ms > 0) {
      clearTimeout(pumpTimer);
      pumpTimer = setTimeout(() => schedulePump(0), ms);
      return;
    }
    if (pumpQueued) return;
    pumpQueued = true;
    requestIdle(() => {
      pumpQueued = false;
      pump();
    });
  };

  const typing = (): boolean => {
    const view = useView.getState();
    return view.textEdit !== null || view.editingSection !== null || performance.now() - lastKeyAt < TYPING_MS;
  };

  /** Slides with a thumbnail and no current snapshot, in capture order. */
  const due = (): string[] => {
    const deck = useDeck.getState();
    const { snapshots } = useLive.getState();
    const key = look();
    const out: string[] = [];
    for (const id of registeredIds()) {
      const entry = deck.slides[id];
      if (!entry || capturing.has(id)) continue;
      const k = snapshotKey(entry.slide, key);
      if (snapshots[id]?.key !== k && failed.get(id) !== k) out.push(id);
    }
    return captureOrder(out, deckOrder(deck), visible);
  };

  /** Starts the next capture that is due. */
  const pump = (): void => {
    if (capturing.size >= CONCURRENCY) return;
    // A capture holds the main thread for a moment: never while a view moves, a pointer is down or someone types.
    if (moving || pointerDown || typing()) {
      schedulePump(300);
      return;
    }
    // Fonts still loading would be measured wrong.
    if (document.fonts && document.fonts.status === 'loading') {
      schedulePump(200);
      return;
    }
    const now = performance.now();
    let waitMs = Infinity;
    for (const id of due()) {
      const quiet = now - (changedAt.get(id) ?? 0);
      if (quiet < SETTLE_MS) {
        waitMs = Math.min(waitMs, SETTLE_MS - quiet);
        continue;
      }
      void capture(id);
      if (capturing.size < CONCURRENCY) schedulePump(0);
      return;
    }
    if (waitMs < Infinity) schedulePump(waitMs);
  };

  const capture = async (id: string): Promise<void> => {
    const deck = useDeck.getState();
    const entry = deck.slides[id];
    if (!entry) return;
    const slide = entry.slide;
    const key = snapshotKey(slide, look());
    capturing.add(id);
    const started = performance.now();
    let blob: Blob | null = null;
    try {
      blob = await snapshotSlide(slide, { resolveSrc, faces: deck.index.faces, scale: SNAPSHOT_SCALE });
    } catch {
      failed.set(id, key);
    } finally {
      capturing.delete(id);
    }
    const took = performance.now() - started;
    stats.captures++;
    stats.captureMs += took;
    stats.worstCaptureMs = Math.max(stats.worstCaptureMs, took);
    stats.firstAt ||= started;
    stats.lastAt = performance.now();
    if (blob && useDeck.getState().slides[id]) {
      // The slide may have changed while it was captured: the image is kept under the key it was taken with.
      const { snapshots } = useLive.getState();
      const old = snapshots[id];
      useLive.setState({ snapshots: { ...snapshots, [id]: { url: URL.createObjectURL(blob), blob, key } } });
      if (old) URL.revokeObjectURL(old.url);
    }
    schedulePump(0);
  };

  useView.subscribe((state, prev) => {
    if (state.current !== prev.current || state.mode !== prev.mode || state.showRail !== prev.showRail || state.canvasEdit !== prev.canvasEdit) queueRecompute();
    if (state.textEdit !== prev.textEdit || state.editingSection !== prev.editingSection) schedulePump(SETTLE_MS);
  });
  useDeck.subscribe((state, prev) => {
    if (state.slides !== prev.slides) {
      const now = performance.now();
      for (const [id, entry] of Object.entries(state.slides)) if (entry.slide !== prev.slides[id]?.slide) changedAt.set(id, now);
      // Slides gone: their snapshots go too.
      const { snapshots } = useLive.getState();
      const gone = Object.keys(snapshots).filter((id) => !state.slides[id]);
      if (gone.length) {
        const next = { ...snapshots };
        for (const id of gone) {
          URL.revokeObjectURL(next[id]!.url);
          delete next[id];
          failed.delete(id);
          changedAt.delete(id);
        }
        useLive.setState({ snapshots: next });
      }
      schedulePump(SETTLE_MS);
    }
    // Reordering moves thumbnails without a scroll.
    if (state.index !== prev.index) requestAnimationFrame(queueRecompute);
  });

  const onScroll = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.hasAttribute('data-open-artifact-thumbs')) moved();
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', moved);
  window.addEventListener('pointerdown', () => (pointerDown = true), true);
  const up = (): void => {
    pointerDown = false;
    schedulePump(IDLE_MS);
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('keydown', () => (lastKeyAt = performance.now()), true);
  document.fonts?.addEventListener('loadingdone', (event) => {
    // A deck face that loads for the first time may change how slides lay out: snapshots taken before it are stale.
    const families = new Set(Object.values(useDeck.getState().index.faces).map((f) => f.family.toLowerCase()));
    let fresh = false;
    for (const face of (event as FontFaceSetLoadEvent).fontfaces) {
      const family = face.family.replace(/^["']|["']$/g, '').toLowerCase();
      const id = `${family}|${face.weight}|${face.style}`;
      if (families.has(family) && !loadedFaces.has(id)) {
        loadedFaces.add(id);
        fresh = true;
      }
    }
    if (fresh) {
      fontEpoch++;
      schedulePump(SETTLE_MS);
    }
  });

  // For benchmarks and debugging (e2e/bench/slides.mjs).
  (globalThis as { __openArtifactLive?: unknown }).__openArtifactLive = () => {
    const ids = registeredIds();
    const pending = due();
    return {
      thumbs: thumbs.size,
      slides: ids.size,
      live: [...useLive.getState().live],
      visible: [...visible],
      snapshots: Object.keys(useLive.getState().snapshots).length,
      due: pending.length + capturing.size,
      capturing: capturing.size,
      failed: failed.size,
      moving,
      pointerDown,
      fontEpoch,
      captures: stats.captures,
      meanCaptureMs: stats.captures ? Math.round(stats.captureMs / stats.captures) : 0,
      worstCaptureMs: Math.round(stats.worstCaptureMs),
      capturingSpanMs: Math.round(stats.lastAt - stats.firstAt),
    };
  };

  return { changed: queueRecompute, moved };
}
