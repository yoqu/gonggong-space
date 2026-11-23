/**
 * The Canvas view drawn by the WebGL canvas engine (@open-artifact/canvas-engine;
 * docs/zh-CN/rust-wasm-core.md §2 and §11, stage S1).
 *
 * The engine draws every slide as a textured rectangle (its snapshot from
 * services/live.ts, or its background color until it has one), the selection,
 * hover and marquee, and runs pan, zoom, glides and slide drags itself: nothing
 * renders in React while the camera moves. "Textures while moving, DOM when
 * still": once the camera settles, the slides that need it (the current one,
 * and the ones drawn larger than their snapshot or still without one) become
 * holes in the canvas with the real slide DOM under them; while the camera
 * moves, those that have a texture are drawn with it again.
 *
 * The deck stays in its stores; {@link EngineBoard} mirrors it into the engine
 * with id-keyed patches and turns the engine's proposals back into commands:
 *
 * - Selection is 'controlled'. Presses on slides select as in the grid
 *   (`pressSlide`), a marquee's proposal is applied, and the stores'
 *   selection is pushed back with `setSelection`.
 * - A slide drag is the engine's own move gesture (the tiles follow the
 *   pointer); its `commit` becomes a reorder (`moveSlidesToGap`, or
 *   `moveSlidesIntoSection` over an empty section) and the tiles go back into
 *   the layout.
 * - Plain drags on the background pan (the engine's pan tool for that press),
 *   as on the DOM board; Shift- or ⌘-drags draw a marquee.
 *
 * Captions, badges, section labels and the "+" stay DOM (CanvasEngineBoard.tsx),
 * moved with the camera by one transform per frame and culled when it settles.
 *
 * `?open_artifact_engine=off` keeps the DOM board; so does a failure to start the engine.
 */

import type { CameraState, CanvasEngine, CanvasEvents, CanvasItem, HoleRect, Point } from '@open-artifact/canvas-engine';
import { parseColor } from '@open-artifact/canvas-engine/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { reconcileSections, sectionGroups, sectionsOf, SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from '@open-artifact/slides-core';
import { deckOrder, useDeck } from '../../state/deck.ts';
import { useView } from '../../state/view.ts';
import { canChange, moveSlidesIntoSection, moveSlidesToGap } from '../../services/commands.ts';
import { noteThumbsMoved, registerSnapshotSource, setDraggedSlides, SNAPSHOT_SCALE, useLive, type Snapshot } from '../../services/live.ts';
import { pressSlide } from '../useSlideDrag.ts';
import { useSectionDrag } from './sectionDrag.ts';
import { canvasLayout, dropGapAt, emptySectionAt, tileAt, tilesIn, TILE_W, type Box, type CanvasLayout } from './canvasLayout.ts';

/** `?open_artifact_engine=off`: the Canvas view stays DOM (for comparing in benchmarks, and as a way out). */
export const engineOff = (() => {
  try {
    return new URLSearchParams(location.search).get('open_artifact_engine') === 'off';
  } catch {
    return false;
  }
})();

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
/** Margin kept around the deck by "Fit all slides", screen px. */
const FIT_MARGIN = 48;
/** Most slides live (DOM under a hole) at once, besides the current one. */
const MAX_LIVE = 12;
/** Slides drawn narrower than this (CSS px) stay textures. */
const MIN_LIVE_PX = 48;
/** A textured slide goes live when drawn this many times wider (device px) than its snapshot. */
const LIVE_OVER_SNAPSHOT = 1.25;
/** Width of the small texture level, px (zoomed-out tiles never need more). */
const SMALL_W = 160;
/** Snapshot decodes running at once. */
const DECODES = 6;
/** Corner radius of a tile, world px (the DOM tiles' `rounded-md`). */
const RADIUS = 6;
/** How long a live slide's pictures may take to decode before its hole opens anyway, ms. */
const READY_TIMEOUT = 500;

/** What the React layers of the engine board render from (changes when the camera settles, not per frame). */
export interface EngineBoardState {
  layout: CanvasLayout;
  /** The world rectangle on screen when the camera last settled (null before the first frame). */
  view: Box | null;
  /** Zoom when the camera last settled. */
  zoom: number;
  /** The slide under the pointer. */
  hover: string | null;
  /** Slides with live DOM under the canvas. */
  live: readonly string[];
  /** A slide drag in progress: the dragged slides and the empty section under the pointer. */
  drag: { ids: readonly string[]; section: string | null } | null;
  /** The slide the context menu was opened on. */
  menu: string | null;
}

/** Where the camera was when the board was last shown (restored when it comes back, e.g. after editing a slide). */
let savedCamera: CameraState | null = null;

/** The outline's layout from the deck store, and a key that changes when it does. */
function layoutOfDeck(): { layout: CanvasLayout; key: string } {
  const deck = useDeck.getState();
  const order = deckOrder(deck);
  const groups = sectionGroups(reconcileSections(sectionsOf({ sections: deck.index.sections }), order), order);
  const key = `${SLIDE_WIDTH}:${JSON.stringify(groups)}`;
  return { layout: canvasLayout(groups, SLIDE_WIDTH, SLIDE_HEIGHT), key };
}

/** `css` when the engine reads it as a colour, else null. */
function engineColor(css: string): string | null {
  try {
    parseColor(css);
    return css;
  } catch {
    return null;
  }
}

interface Colors {
  accent: string;
  accentSoft: string;
  line: string;
  lineStrong: string;
}

/** The UI kit's colors in effect (light or dark). */
function themeColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => engineColor(style.getPropertyValue(name).trim()) ?? fallback;
  return {
    accent: read('--open-artifact-accent', '#2563eb'),
    accentSoft: read('--open-artifact-accent-soft', 'rgba(37, 99, 235, 0.12)'),
    line: read('--open-artifact-line', 'rgba(0, 0, 0, 0.1)'),
    lineStrong: read('--open-artifact-line-strong', 'rgba(0, 0, 0, 0.2)'),
  };
}

/** Waits for the pictures in `el` to decode (at most `timeout` ms). */
async function picturesDecoded(el: HTMLElement, timeout: number): Promise<void> {
  const images = Array.from(el.querySelectorAll('img'), (image) => image.decode().catch(() => undefined));
  await Promise.race([Promise.all(images), new Promise((resolve) => setTimeout(resolve, timeout))]);
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** The texture key of a snapshot: the slide and what the image was taken from. */
const textureKey = (id: string, snapshot: Snapshot): string => `${id}|${snapshot.key}`;

/**
 * One engine-drawn Canvas view: owns the engine, mirrors the deck into it and
 * routes its input. Create it, `start` it on the board's elements, `destroy`
 * it on unmount.
 */
export class EngineBoard {
  readonly store: StoreApi<EngineBoardState>;
  #engine: CanvasEngine | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #destroyed = false;
  #cleanup: (() => void)[] = [];
  #layoutKey: string;
  #camera: CameraState = { x: 0, y: 0, zoom: 1 };
  /** The camera is moving (not yet settled). */
  #moving = false;
  /** Slides on screen when the camera last settled. */
  #visible = new Set<string>();
  #live = new Set<string>();
  /** Signature of each item in the engine's mirror. */
  #mirror = new Map<string, string>();
  /** Slides drawn as holes now. */
  #holes = new Set<string>();
  /** Texture key each slide's item uses. */
  #keys = new Map<string, string>();
  /** Slide of every texture key held or being made. */
  #keySlide = new Map<string, string>();
  /** Resolutions uploaded per key: 1 the small one, 2 small and large. */
  #levels = new Map<string, 1 | 2>();
  #queue: string[] = [];
  #decoding = new Set<string>();
  /** Live slide elements (under the canvas), and those rendered far enough to show. */
  #liveEls = new Map<string, HTMLElement>();
  #ready = new Set<string>();
  /** Elements moved with the camera (the overlay's world), and the zoom readout. */
  #worlds = new Set<HTMLElement>();
  #readouts = new Set<HTMLElement>();
  #colors: Colors = { accent: '#2563eb', accentSoft: 'rgba(37, 99, 235, 0.12)', line: 'rgba(0, 0, 0, 0.1)', lineStrong: 'rgba(0, 0, 0, 0.2)' };
  #fills = new Map<string, string>();
  /** A plain press on a slide the engine follows (a drag starts from it). */
  #press: { id: string; world: Point; moved: boolean } | null = null;
  #marquee = false;
  /** A slide drag: the dragged slides (deck order) and where the pointer pressed (world). */
  #drag: { ids: string[]; origin: Point } | null = null;

  constructor() {
    const { layout, key } = layoutOfDeck();
    this.#layoutKey = key;
    this.store = createStore<EngineBoardState>()(() => ({ layout, view: null, zoom: 1, hover: null, live: [], drag: null, menu: null }));
  }

  /** Starts the engine on `canvas` (inside `surface`, which takes the presses first). Rejects when it cannot run. */
  async start(surface: HTMLElement, canvas: HTMLCanvasElement): Promise<void> {
    const { CanvasEngine } = await import('@open-artifact/canvas-engine');
    if (this.#destroyed) return;
    this.#colors = themeColors();
    const engine = await CanvasEngine.create(canvas, {
      selection: 'controlled',
      snap: false,
      grid: 'none',
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      cameraEventMs: 0,
      dragEvents: true,
      dragThreshold: 5,
      // As the DOM canvas: ⌘/Ctrl-wheel zooms by exp(-deltaY × 0.01) per event, unlimited.
      zoomSpeed: 0.01,
      wheelZoomMax: Infinity,
      theme: this.#theme(),
    });
    if (this.#destroyed) {
      engine.destroy();
      return;
    }
    this.#engine = engine;
    this.#canvas = canvas;
    const on = <K extends keyof CanvasEvents>(event: K, fn: (e: CanvasEvents[K]) => void): void => {
      this.#cleanup.push(engine.on(event, fn));
    };
    on('camera', (c) => this.#onCamera(c));
    on('moving', ({ moving }) => {
      if (!moving) return;
      this.#moving = true;
      this.#sync();
    });
    on('holes', ({ holes }) => this.#placeLive(holes));
    on('textureNeeded', ({ keys }) => this.#need(keys));
    on('hover', ({ id }) => this.store.setState({ hover: id }));
    on('gesture', (g) => this.#onGesture(g));
    on('dragging', (d) => this.#onDragging(d));
    on('dblclick', ({ id, world }) => {
      const slide = this.#slideAt(id, world);
      if (slide) useView.getState().editOnCanvas(slide);
    });
    on('contextmenu', ({ id, world, event }) => {
      const slide = this.#slideAt(id, world);
      // Off the slides: the browser's own menu, as on the DOM board.
      if (!slide) {
        event?.stopPropagation();
        return;
      }
      if (!useView.getState().slideSelection.includes(slide)) useView.getState().showSlide(slide);
      this.store.setState({ menu: slide });
    });
    on('commit', (c) => {
      if (c.op === 'select') {
        if (this.#marquee) this.#selectFromMarquee(c.ids);
      } else if (c.op === 'move') this.#onMoved();
    });
    this.#listen(surface, canvas);
    this.#subscribe();
    this.#snapshotsChanged();
    this.#sync();
    if (savedCamera) engine.setCamera(savedCamera);
    else this.fit(0);
    (globalThis as { __openArtifactCanvasEngine?: unknown }).__openArtifactCanvasEngine = () => this.#debug();
  }

  /** Stops the engine and lets go of the stores. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const fn of this.#cleanup) fn();
    this.#cleanup.length = 0;
    this.#engine?.destroy();
    this.#engine = null;
    if (this.#drag) {
      useView.getState().setDropGap(null);
      setDraggedSlides([]);
    }
    const hooks = globalThis as { __openArtifactCanvasEngine?: unknown };
    delete hooks.__openArtifactCanvasEngine;
  }

  /* ------------------------------------------------------------------ camera */

  /** Frames the whole deck (animated over `duration` ms). */
  fit(duration = 300): void {
    const { layout } = this.store.getState();
    this.#engine?.glideTo({ x: 0, y: 0, w: layout.width, h: layout.height }, { duration, padding: FIT_MARGIN, maxZoom: 1 });
  }

  /** Zooms by `factor` about the middle of the view. */
  zoomBy(factor: number): void {
    this.#engine?.zoomAt(factor);
  }

  /** Moves `el` with the camera (an element in world units, `transform-origin: 0 0`). Returns the detach function. */
  attachWorld(el: HTMLElement): () => void {
    this.#worlds.add(el);
    el.style.transform = this.#worldTransform();
    return () => this.#worlds.delete(el);
  }

  /** Shows the zoom (percent) in `el`, updated every frame. Returns the detach function. */
  attachZoomReadout(el: HTMLElement): () => void {
    this.#readouts.add(el);
    el.textContent = `${Math.round(this.#camera.zoom * 100)}%`;
    return () => this.#readouts.delete(el);
  }

  #worldTransform(): string {
    const { x, y, zoom } = this.#camera;
    return `translate(${-x * zoom}px, ${-y * zoom}px) scale(${zoom})`;
  }

  #onCamera(c: CameraState & { settled: boolean }): void {
    this.#camera = { x: c.x, y: c.y, zoom: c.zoom };
    savedCamera = this.#camera;
    const transform = this.#worldTransform();
    for (const el of this.#worlds) el.style.transform = transform;
    const zoom = `${Math.round(c.zoom * 100)}%`;
    for (const el of this.#readouts) el.textContent = zoom;
    // Snapshots wait while the view moves (services/live.ts).
    noteThumbsMoved();
    if (c.settled) {
      this.#moving = false;
      this.#refresh();
    }
  }

  /** After the camera settles or the layout changes: what is on screen, which slides go live, which textures grow. */
  #refresh(): void {
    const engine = this.#engine;
    if (!engine) return;
    const { layout } = this.store.getState();
    const view = engine.viewport();
    this.#visible = new Set(tilesIn(layout, view).map((t) => t.id));
    const live = this.#wantedLive(view);
    const prev = this.store.getState().live;
    this.#live = new Set(live);
    this.store.setState({
      view,
      zoom: this.#camera.zoom,
      live: live.length === prev.length && live.every((id, i) => prev[i] === id) ? prev : live,
    });
    for (const [id, el] of this.#liveEls) if (!this.#holes.has(id)) this.#placeHeld(id, el);
    for (const id of this.#visible) {
      const key = this.#keys.get(id);
      if (key && this.#levels.get(key) === 1 && this.#wantsLarge()) this.#enqueue(key);
    }
    this.#sync();
  }

  /**
   * Slides that should be live: on screen and drawn at least `MIN_LIVE_PX`
   * wide, either without a texture or drawn larger than their snapshot,
   * nearest the middle first, at most `MAX_LIVE`; plus the current slide
   * when it is on screen.
   */
  #wantedLive(view: Box): string[] {
    const { layout } = this.store.getState();
    const width = TILE_W * this.#camera.zoom;
    const device = width * (devicePixelRatio || 1);
    const sharp = SLIDE_WIDTH * SNAPSHOT_SCALE * LIVE_OVER_SNAPSHOT;
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const out =
      width < MIN_LIVE_PX
        ? []
        : tilesIn(layout, view)
            .filter((t) => !this.#textured(t.id) || device > sharp)
            .map((t) => ({ id: t.id, d: Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, MAX_LIVE)
            .map((t) => t.id);
    const current = useView.getState().current;
    if (current && this.#visible.has(current) && !out.includes(current)) out.push(current);
    return out;
  }

  /* -------------------------------------------------------------- the mirror */

  /** Brings the engine's items in line with the deck, the live set and the textures. */
  #sync(): void {
    const engine = this.#engine;
    // Tiles under a drag stay where the engine put them; the drag's end syncs.
    if (!engine || this.#drag) return;
    const { layout } = this.store.getState();
    const deck = useDeck.getState();
    const movable = canChange();
    const lifted = new Set(useSectionDrag.getState().drag?.keys ?? []);
    const upsert: CanvasItem[] = [];
    const seen = new Set<string>();
    let added = false;
    for (const tile of layout.tiles) {
      const slide = deck.slides[tile.id]?.slide;
      if (!slide) continue;
      const key = layout.rows[tile.row]?.key;
      const hole = this.#ready.has(tile.id) && this.#live.has(tile.id) && !(this.#moving && this.#textured(tile.id));
      const base = { id: tile.id, x: tile.x, y: tile.y, w: tile.w, h: tile.h, radius: RADIUS, movable, resizable: false, snap: false };
      const item: CanvasItem = hole
        ? { ...base, kind: 'hole' }
        : {
            ...base,
            kind: 'image',
            fill: this.#fill(slide),
            stroke: this.#colors.line,
            strokeWidth: 1,
            screenStroke: true,
            texture: this.#keys.get(tile.id),
            opacity: (slide.hidden ? 0.5 : 1) * (key && lifted.has(key) ? 0.4 : 1),
          };
      seen.add(tile.id);
      if (hole) this.#holes.add(tile.id);
      else this.#holes.delete(tile.id);
      const signature = JSON.stringify(item);
      if (this.#mirror.get(tile.id) === signature) continue;
      if (!this.#mirror.has(tile.id)) added = true;
      this.#mirror.set(tile.id, signature);
      upsert.push(item);
    }
    const remove = [...this.#mirror.keys()].filter((id) => !seen.has(id));
    for (const id of remove) {
      this.#mirror.delete(id);
      this.#holes.delete(id);
    }
    if (upsert.length || remove.length) engine.applyPatch({ upsert, remove });
    if (added) this.#applySelection();
  }

  /** What a slide shows before its texture: its background color (white for pictures and gradients). */
  #fill(slide: Slide): string {
    const value = slide.style.background;
    if (!value || /url\(|gradient/i.test(value)) return '#ffffff';
    let fill = this.#fills.get(value);
    if (fill === undefined) {
      fill = engineColor(value) ?? '#ffffff';
      this.#fills.set(value, fill);
    }
    return fill;
  }

  #theme() {
    const c = this.#colors;
    return { background: 'transparent', grid: 'transparent', selection: c.accent, handle: c.accent, guide: c.accent, marquee: c.accentSoft, hover: c.lineStrong };
  }

  /** The stores' slide selection (and the current slide) drawn by the engine. */
  #applySelection(): void {
    const view = useView.getState();
    const ids = new Set(view.slideSelection);
    if (view.current) ids.add(view.current);
    this.#engine?.setSelection([...ids].filter((id) => this.#mirror.has(id)));
  }

  #relayout(): void {
    const { layout, key } = layoutOfDeck();
    if (key !== this.#layoutKey) {
      this.#layoutKey = key;
      this.store.setState({ layout });
      this.#refresh();
    } else this.#sync();
  }

  #subscribe(): void {
    const add = (fn: () => void): void => {
      this.#cleanup.push(fn);
    };
    add(
      useDeck.subscribe((s, prev) => {
        if (s.index !== prev.index || s.slides !== prev.slides || s.status !== prev.status || s.readOnly !== prev.readOnly) this.#relayout();
      }),
    );
    add(
      useView.subscribe((s, prev) => {
        if (s.slideSelection !== prev.slideSelection || s.current !== prev.current) this.#applySelection();
        if (s.current !== prev.current && !this.#moving) this.#refresh();
      }),
    );
    add(useSectionDrag.subscribe(() => this.#sync()));
    add(
      useLive.subscribe((s, prev) => {
        if (s.snapshots !== prev.snapshots) this.#snapshotsChanged();
      }),
    );
    add(registerSnapshotSource({ ids: () => this.store.getState().layout.byId.keys(), visible: () => this.#visible }));
    // Light / dark: the selection, hover and stroke colors follow.
    const retheme = (): void => {
      this.#colors = themeColors();
      this.#fills.clear();
      this.#engine?.setOptions({ theme: this.#theme() });
      this.#mirror.clear();
      this.#sync();
    };
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', retheme);
    add(() => media.removeEventListener('change', retheme));
    const observer = new MutationObserver(retheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    add(() => observer.disconnect());
  }

  /* ---------------------------------------------------------------- textures */

  #textured(id: string): boolean {
    const key = this.#keys.get(id);
    return key !== undefined && this.#levels.has(key);
  }

  /** Whether tiles are drawn wider than the small texture level (device px). */
  #wantsLarge(): boolean {
    return TILE_W * this.#camera.zoom * (devicePixelRatio || 1) > SMALL_W;
  }

  /** Snapshots arrived, changed or went: the items' texture keys follow. */
  #snapshotsChanged(): void {
    const { snapshots } = useLive.getState();
    const ids = new Set([...this.#keys.keys(), ...Object.keys(snapshots)]);
    let changed = false;
    for (const id of ids) {
      const snapshot = snapshots[id];
      const next = snapshot ? textureKey(id, snapshot) : undefined;
      const current = this.#keys.get(id);
      if (next === current || (next && this.#keySlide.has(next))) continue;
      if (next && current && this.#visible.has(id)) {
        // A slide on screen changed: make the new texture before switching, so its old picture never blinks to the placeholder.
        this.#keySlide.set(next, id);
        void this.#upload(next).finally(() => {
          if (this.#switchTexture(id, next)) this.#sync();
        });
      } else changed = this.#switchTexture(id, next) || changed;
    }
    if (changed) this.#sync();
  }

  /** Points slide `id` at texture `next` (dropping the one it had); false when `next` was superseded meanwhile. Sync after. */
  #switchTexture(id: string, next: string | undefined): boolean {
    if (this.#destroyed) return false;
    const snapshot = useLive.getState().snapshots[id];
    if (next && (!snapshot || textureKey(id, snapshot) !== next)) {
      this.#dropTexture(next);
      return false;
    }
    const current = this.#keys.get(id);
    if (next) {
      this.#keys.set(id, next);
      this.#keySlide.set(next, id);
    } else this.#keys.delete(id);
    if (current && current !== next) this.#dropTexture(current);
    return true;
  }

  #dropTexture(key: string): void {
    this.#keySlide.delete(key);
    this.#levels.delete(key);
    this.#engine?.removeTexture(key);
  }

  #need(keys: string[]): void {
    for (const key of keys) {
      // Asked again: evicted (or never made).
      this.#levels.delete(key);
      if (this.#keySlide.has(key)) this.#enqueue(key);
    }
  }

  #enqueue(key: string): void {
    if (!this.#decoding.has(key) && !this.#queue.includes(key)) this.#queue.push(key);
    this.#pump();
  }

  /** Starts queued decodes, up to `DECODES` at once. */
  #pump(): void {
    while (this.#decoding.size < DECODES && this.#queue.length) {
      const next = this.#queue.shift()!;
      this.#decoding.add(next);
      void this.#upload(next).finally(() => {
        this.#decoding.delete(next);
        this.#pump();
      });
    }
  }

  /** Decodes a snapshot into the texture `key`: the small level, and the snapshot's own size when tiles are drawn larger. */
  async #upload(key: string): Promise<void> {
    const id = this.#keySlide.get(key);
    const snapshot = id ? useLive.getState().snapshots[id] : undefined;
    if (!id || !snapshot || textureKey(id, snapshot) !== key) return;
    const large = this.#wantsLarge();
    const { layout } = this.store.getState();
    const bitmaps: ImageBitmap[] = [];
    try {
      const options = { premultiplyAlpha: 'premultiply' } as const;
      bitmaps.push(await createImageBitmap(snapshot.blob, { ...options, resizeWidth: SMALL_W, resizeHeight: Math.round((SMALL_W * layout.slideH) / TILE_W), resizeQuality: 'medium' }));
      if (large) bitmaps.push(await createImageBitmap(snapshot.blob, options));
      if (!this.#engine || this.#keySlide.get(key) !== id) return;
      if (this.#engine.setTexture(key, bitmaps)) this.#levels.set(key, large ? 2 : 1);
    } catch {
      // An image the browser will not decode (or a lost context): the tile keeps its placeholder.
    } finally {
      for (const bitmap of bitmaps) bitmap.close();
    }
  }

  /* -------------------------------------------------------------- live slides */

  /**
   * A live slide's element (under the canvas, world-sized, `transform-origin:
   * 0 0`) mounted: placed and hidden until its pictures decode, then its tile
   * opens as a hole over it. Returns the function to call on unmount.
   */
  attachLive(id: string, el: HTMLElement): () => void {
    this.#liveEls.set(id, el);
    this.#placeHeld(id, el);
    let attached = true;
    void (async () => {
      // Two frames for the slide to lay out (and fit its text), then its pictures.
      await nextFrame();
      await nextFrame();
      await picturesDecoded(el, READY_TIMEOUT);
      if (!attached || this.#liveEls.get(id) !== el) return;
      this.#ready.add(id);
      this.#sync();
    })();
    return () => {
      attached = false;
      if (this.#liveEls.get(id) !== el) return;
      this.#liveEls.delete(id);
      this.#ready.delete(id);
      this.#sync();
    };
  }

  /** Places a live element over its tile from the camera, hidden (the tile is still drawn above it). */
  #placeHeld(id: string, el: HTMLElement): void {
    const tile = this.store.getState().layout.byId.get(id);
    if (!tile) return;
    const { x, y, zoom } = this.#camera;
    el.style.transform = `matrix(${zoom}, 0, 0, ${zoom}, ${(tile.x - x) * zoom}, ${(tile.y - y) * zoom})`;
    el.style.visibility = 'hidden';
  }

  /** Shows the live elements whose holes are on screen, where the engine says; hides the others. */
  #placeLive(holes: HoleRect[]): void {
    const open = new Map(holes.map((h) => [h.id, h]));
    for (const [id, el] of this.#liveEls) {
      const hole = open.get(id);
      if (hole) {
        el.style.transform = hole.transform;
        el.style.visibility = 'visible';
      } else el.style.visibility = 'hidden';
    }
  }

  /* -------------------------------------------------------------------- input */

  /** The slide (or its caption) under a client point. */
  hitAt(clientX: number, clientY: number): ReturnType<typeof tileAt> {
    if (!this.#engine || !this.#canvas) return null;
    const box = this.#canvas.getBoundingClientRect();
    const world = this.#engine.screenToWorld({ x: clientX - box.left, y: clientY - box.top });
    return tileAt(this.store.getState().layout, world.x, world.y);
  }

  #listen(surface: HTMLElement, canvas: HTMLCanvasElement): void {
    const add = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, capture = false): void => {
      surface.addEventListener(type, fn, capture);
      this.#cleanup.push(() => surface.removeEventListener(type, fn, capture));
    };
    // Before the engine's own listener on the canvas.
    add('pointerdown', (e) => this.#onPress(e, canvas), true);
    // The wheel over a label or a "+" pans and zooms as it does over the canvas.
    add(
      'wheel',
      (e) => {
        if (e.target === canvas || (e.target instanceof Element && e.target.closest('textarea'))) return;
        e.preventDefault();
        canvas.dispatchEvent(new WheelEvent('wheel', e));
      },
      false,
    );
    // Over labels and buttons the browser's own menu, as on the DOM board (the engine reports the canvas' own).
    add(
      'contextmenu',
      (e) => {
        if (e.target !== canvas) e.stopPropagation();
      },
      true,
    );
  }

  /** The slide double-clicked or right-clicked: the engine's item, or the slide whose caption it is. */
  #slideAt(id: string | null, world: Point): string | null {
    return id ?? tileAt(this.store.getState().layout, world.x, world.y)?.tile.id ?? null;
  }

  #onPress(e: PointerEvent, canvas: HTMLCanvasElement): void {
    const engine = this.#engine;
    if (e.button !== 0 || !engine || e.target !== canvas) return;
    const hit = this.hitAt(e.clientX, e.clientY);
    if (!hit) {
      // Shift / ⌘ + drag: the engine's marquee (Shift adds to the selection).
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) this.#panFromBackground(e, engine);
      return;
    }
    const id = hit.tile.id;
    const selected = useView.getState().slideSelection.includes(id);
    const plain = pressSlide(id, e);
    // Shift / ⌘ presses only select, and a caption is not part of the engine's tile: the engine never sees those.
    if (!plain || hit.caption) e.stopPropagation();
    const box = canvas.getBoundingClientRect();
    const press = { id, world: engine.screenToWorld({ x: e.clientX - box.left, y: e.clientY - box.top }), moved: false };
    this.#press = press;
    const up = (event: PointerEvent): void => {
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (this.#press === press) this.#press = null;
      // A plain click inside a multi-selection selects just this slide.
      if (event.type === 'pointerup' && plain && !press.moved && selected && useView.getState().slideSelection.length > 1) useView.getState().selectSlides([id]);
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  /** A plain press on the background: the engine pans for it; without travel it is a click that keeps only the current slide selected. */
  #panFromBackground(e: PointerEvent, engine: CanvasEngine): void {
    engine.setTool('pan');
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (event: PointerEvent): void => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) >= 3) moved = true;
    };
    const done = (event: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      this.#engine?.setTool('select');
      if (moved || event.type !== 'pointerup') return;
      const view = useView.getState();
      view.selectSections([]);
      view.selectSlides(view.current ? [view.current] : []);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  }

  #onGesture(g: CanvasEvents['gesture']): void {
    if (g.kind === 'marquee') this.#marquee = g.phase === 'start';
    if (g.kind !== 'move') return;
    if (g.phase === 'start') {
      if (this.#press) this.#press.moved = true;
      return;
    }
    // The drag ended (after its commit) or was cancelled: the tiles go back into the layout.
    const drag = this.#drag;
    this.#drag = null;
    useView.getState().setDropGap(null);
    setDraggedSlides([]);
    this.store.setState({ drag: null });
    if (drag) for (const id of drag.ids) this.#mirror.delete(id);
    this.#sync();
  }

  #onDragging({ ids, dx, dy }: CanvasEvents['dragging']): void {
    const { layout } = this.store.getState();
    if (!this.#drag) {
      const order = deckOrder(useDeck.getState());
      const press = this.#press;
      const first = layout.byId.get(ids[0] ?? '');
      this.#drag = { ids: order.filter((id) => ids.includes(id)), origin: press ? press.world : { x: first?.x ?? 0, y: first?.y ?? 0 } };
      setDraggedSlides(this.#drag.ids);
    }
    const x = this.#drag.origin.x + dx;
    const y = this.#drag.origin.y + dy;
    const section = emptySectionAt(layout, x, y);
    useView.getState().setDropGap(section ? null : dropGapAt(layout, x, y));
    const current = this.store.getState().drag;
    if (!current || current.section !== section) this.store.setState({ drag: { ids: this.#drag.ids, section } });
  }

  /** A slide drag was dropped: the slides move to the gap (or empty section) under the pointer. */
  #onMoved(): void {
    const drag = this.#drag;
    if (!drag) return;
    const section = this.store.getState().drag?.section ?? null;
    const gap = useView.getState().dropGap;
    if (section) moveSlidesIntoSection(drag.ids, section, 0);
    else if (gap !== null) moveSlidesToGap(drag.ids, gap);
  }

  #selectFromMarquee(ids: readonly string[]): void {
    const view = useView.getState();
    const picked = deckOrder(useDeck.getState()).filter((id) => ids.includes(id));
    view.selectSections([]);
    if (!picked.length) {
      view.selectSlides(view.current ? [view.current] : []);
      return;
    }
    if (!view.current || !picked.includes(view.current)) view.showSlide(picked[0]!, { keepSelection: true });
    useView.getState().selectSlides(picked);
  }

  /* ---------------------------------------------------------------- debugging */

  /** For benchmarks and debugging (e2e/bench/slides.mjs): what the board shows. */
  #debug() {
    let shown = 0;
    for (const id of this.#visible) if (this.#textured(id) || this.#holes.has(id)) shown++;
    const { layout, live } = this.store.getState();
    return {
      tiles: layout.tiles.length,
      visible: this.#visible.size,
      visibleShown: shown,
      live: live.length,
      holes: this.#holes.size,
      textures: this.#levels.size,
      large: [...this.#levels.values()].filter((n) => n === 2).length,
      camera: this.#camera,
      moving: this.#moving,
      engine: this.#engine?.stats() ?? null,
    };
  }
}
