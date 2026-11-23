/**
 * `CanvasEngine`: the TypeScript face of the wasm canvas core.
 *
 * TypeScript owns the document. The engine keeps a mirror of what to draw, updated
 * with id-keyed patches (`applyPatch`), renders every frame in wasm, and handles
 * pointer, wheel, touch and keyboard input itself. It reports low-frequency events
 * (selection, camera, commits, texture requests, holes…) and never edits the
 * document: a finished drag is a `commit` the owner applies (or not; see `commit`).
 */

import { loadCanvasWasm, type CanvasCore } from '@open-artifact/wasm-canvas';
import { screenToWorld, visibleRect, worldToScreen } from './camera.ts';
import {
  CURSORS,
  FRAME_HOLES,
  FRAME_MORE,
  FRAME_RENDER,
  KEY_ESCAPE,
  KEY_MODIFIER,
  KEY_SPACE,
  MOD_ALT,
  MOD_CTRL,
  MOD_META,
  MOD_SHIFT,
  OPTION,
  PatchEncoder,
  POINTER_TYPES,
  THEME_OPTION,
  TOOLS,
  parseColor,
} from './protocol.ts';
import type {
  CameraState,
  CanvasEventName,
  CanvasEvents,
  CanvasItem,
  CreateOptions,
  EngineOptions,
  EngineStats,
  GlideOptions,
  Handle,
  HoleRect,
  Modifiers,
  Patch,
  Peer,
  Point,
  PointerInput,
  Rect,
  TextureSource,
  Tool,
} from './types.ts';

type Listener<K extends CanvasEventName> = (event: CanvasEvents[K]) => void;

type RawRect = [number, number, number, number];

/** Raw events from the core (ids are handles, `mods` are MOD_* bits). */
type CoreEvent =
  | { type: 'selection'; ids: number[]; mods: number }
  | { type: 'camera'; x: number; y: number; zoom: number; settled: boolean }
  | { type: 'moving'; moving: boolean }
  | { type: 'commit'; mods: number; op: 'move'; ids: number[]; dx: number; dy: number }
  | { type: 'commit'; mods: number; op: 'resize'; id: number; rect: RawRect }
  | { type: 'commit'; mods: number; op: 'select'; ids: number[] }
  | { type: 'textureNeeded'; keys: number[] }
  | { type: 'hover'; id: number | null }
  | { type: 'gesture'; kind: CanvasEvents['gesture']['kind']; phase: CanvasEvents['gesture']['phase']; mods: number }
  | { type: 'dragging'; ids: number[]; dx: number; dy: number; mods: number }
  | { type: 'resizing'; id: number; rect: RawRect; mods: number }
  | { type: 'pointer'; kind: 'dblclick' | 'contextmenu'; id: number | null; world: [number, number]; screen: [number, number]; mods: number }
  | { type: 'contextrestored' };

/** Handle edge bits from the core (left, right, top, bottom) to compass names. */
const HANDLES: Record<number, Handle> = { 5: 'nw', 4: 'n', 6: 'ne', 2: 'e', 10: 'se', 8: 's', 9: 'sw', 1: 'w' };
const TOOL_NAMES: Tool[] = ['select', 'pan', 'none'];

function modifiers(m: number): Modifiers {
  return { shift: !!(m & MOD_SHIFT), alt: !!(m & MOD_ALT), ctrl: !!(m & MOD_CTRL), meta: !!(m & MOD_META) };
}

function rectOf(r: RawRect): Rect {
  return { x: r[0], y: r[1], w: r[2], h: r[3] };
}

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
};

function modsOf(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): number {
  return (e.shiftKey ? MOD_SHIFT : 0) | (e.altKey ? MOD_ALT : 0) | (e.ctrlKey ? MOD_CTRL : 0) | (e.metaKey ? MOD_META : 0);
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function sourceSize(s: TextureSource): [number, number] {
  if (typeof HTMLImageElement !== 'undefined' && s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
  return [s.width, s.height];
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class CanvasEngine {
  readonly canvas: HTMLCanvasElement | null;
  #core: CanvasCore;
  #memory: WebAssembly.Memory;
  #enc = new PatchEncoder();
  #listeners = new Map<CanvasEventName, Set<(e: never) => void>>();
  #raf = 0;
  #destroyed = false;
  #cleanup: (() => void)[] = [];
  #dpr: number;
  #size: [number, number];
  #maxZoom = 64;
  #rect: DOMRect | null = null;
  #cursor = -1;
  #lost = false;
  /** The DOM event being handled, handed to `dblclick`/`contextmenu` listeners. */
  #domEvent: MouseEvent | undefined;

  private constructor(core: CanvasCore, memory: WebAssembly.Memory, canvas: HTMLCanvasElement | null, size: [number, number], dpr: number) {
    this.#core = core;
    this.#memory = memory;
    this.canvas = canvas;
    this.#size = size;
    this.#dpr = dpr;
  }

  /**
   * Creates an engine drawing into `canvas` (WebGL2). The canvas is sized to its CSS
   * box times the device pixel ratio, and follows it.
   */
  static async create(canvas: HTMLCanvasElement, options: CreateOptions = {}): Promise<CanvasEngine> {
    const wasm = await loadCanvasWasm();
    const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    if (!gl) throw new Error('canvas-engine: WebGL2 is not available');
    const dpr = options.dpr ?? (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const box = canvas.getBoundingClientRect();
    const w = box.width || canvas.width / dpr;
    const h = box.height || canvas.height / dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const core = new wasm.CanvasCore(gl, w, h, dpr);
    const engine = new CanvasEngine(core, wasm.memory, canvas, [w, h], dpr);
    engine.setOptions(options);
    if (options.tool) engine.setTool(options.tool);
    if (options.listen !== false) engine.#listen(canvas);
    engine.requestFrame();
    return engine;
  }

  /**
   * An engine without a canvas or GPU: same scene, camera, gestures and events,
   * nothing drawn. Frames advance only through `tick(now)`. For tests and tools.
   */
  static async createHeadless(options: CreateOptions & { width: number; height: number }): Promise<CanvasEngine> {
    const wasm = await loadCanvasWasm();
    const dpr = options.dpr ?? 1;
    const core = new wasm.CanvasCore(undefined, options.width, options.height, dpr);
    const engine = new CanvasEngine(core, wasm.memory, null, [options.width, options.height], dpr);
    engine.setOptions(options);
    if (options.tool) engine.setTool(options.tool);
    return engine;
  }

  // ---------------------------------------------------------------- events

  /** Subscribes to an event; returns the unsubscribe function. */
  on<K extends CanvasEventName>(event: K, cb: Listener<K>): () => void {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(cb as (e: never) => void);
    return () => set.delete(cb as (e: never) => void);
  }

  #emit<K extends CanvasEventName>(event: K, payload: CanvasEvents[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const cb of set) (cb as Listener<K>)(payload);
  }

  #drain(): void {
    if (!this.#core.has_events()) return;
    const events = JSON.parse(this.#core.take_events()) as CoreEvent[];
    const items = this.#enc.items;
    for (const e of events) {
      switch (e.type) {
        case 'selection':
          this.#emit('selection', { ids: items.ids(e.ids), modifiers: modifiers(e.mods) });
          break;
        case 'camera':
          this.#emit('camera', { x: e.x, y: e.y, zoom: e.zoom, settled: e.settled });
          break;
        case 'moving':
          this.#emit('moving', { moving: e.moving });
          break;
        case 'commit': {
          const m = modifiers(e.mods);
          if (e.op === 'move') this.#emit('commit', { op: 'move', ids: items.ids(e.ids), dx: e.dx, dy: e.dy, modifiers: m });
          else if (e.op === 'resize') {
            const id = items.id(e.id);
            if (id !== undefined) this.#emit('commit', { op: 'resize', id, rect: rectOf(e.rect), modifiers: m });
          } else this.#emit('commit', { op: 'select', ids: items.ids(e.ids), modifiers: m });
          break;
        }
        case 'textureNeeded':
          this.#emit('textureNeeded', { keys: this.#enc.textures.ids(e.keys) });
          break;
        case 'hover':
          this.#emit('hover', { id: e.id === null ? null : (items.id(e.id) ?? null) });
          break;
        case 'gesture':
          this.#emit('gesture', { kind: e.kind, phase: e.phase, modifiers: modifiers(e.mods) });
          break;
        case 'dragging':
          this.#emit('dragging', { ids: items.ids(e.ids), dx: e.dx, dy: e.dy, modifiers: modifiers(e.mods) });
          break;
        case 'resizing': {
          const id = items.id(e.id);
          if (id !== undefined) this.#emit('resizing', { id, rect: rectOf(e.rect), modifiers: modifiers(e.mods) });
          break;
        }
        case 'pointer':
          this.#emit(e.kind, {
            id: e.id === null ? null : (items.id(e.id) ?? null),
            world: { x: e.world[0], y: e.world[1] },
            screen: { x: e.screen[0], y: e.screen[1] },
            modifiers: modifiers(e.mods),
            event: this.#domEvent,
          });
          break;
        case 'contextrestored':
          this.#emit('contextrestored', {});
          break;
      }
    }
  }

  // ---------------------------------------------------------------- frames

  /** Schedules a frame (no-op if one is scheduled, or headless). */
  requestFrame(): void {
    if (this.#raf || this.#destroyed || !this.canvas || typeof requestAnimationFrame === 'undefined') return;
    this.#raf = requestAnimationFrame(t => {
      this.#raf = 0;
      this.tick(t);
    });
  }

  /** Advances one frame at time `t` (ms): animations, events, drawing. Called by the frame loop. */
  tick(t: number = now()): void {
    if (this.#destroyed) return;
    const t0 = now();
    const bits = this.#lost ? 0 : this.#core.frame(t);
    const engineMs = now() - t0;
    this.#drain();
    if (bits & FRAME_HOLES) this.#emit('holes', { holes: this.holes() });
    if (bits & FRAME_RENDER) this.#emit('frame', { engineMs });
    if (bits & FRAME_MORE) this.requestFrame();
  }

  /** Visible holes in screen space. */
  holes(): HoleRect[] {
    const raw = this.#core.holes();
    const out: HoleRect[] = [];
    for (let i = 0; i + 6 < raw.length; i += 7) {
      const id = this.#enc.items.id(raw[i]!);
      if (id === undefined) continue;
      const [x, y, w, h, rotation, zoom] = [raw[i + 1]!, raw[i + 2]!, raw[i + 3]!, raw[i + 4]!, raw[i + 5]!, raw[i + 6]!];
      // The element is world-sized at the canvas origin: scale, rotate about its centre, then place.
      const c = Math.cos(rotation) * zoom;
      const s = Math.sin(rotation) * zoom;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const ww = w / zoom / 2;
      const hh = h / zoom / 2;
      const e = cx - (c * ww - s * hh);
      const f = cy - (s * ww + c * hh);
      out.push({ id, x, y, w, h, rotation, zoom, transform: `matrix(${c}, ${s}, ${-s}, ${c}, ${e}, ${f})` });
    }
    return out;
  }

  #touch(): void {
    this.#drain();
    this.#syncCursor();
    this.requestFrame();
  }

  #syncCursor(): void {
    if (!this.canvas) return;
    const c = this.#core.cursor();
    if (c !== this.#cursor) {
      this.#cursor = c;
      this.canvas.style.cursor = CURSORS[c] ?? 'default';
    }
  }

  // ---------------------------------------------------------------- scene

  /** Applies a patch (or a list of items to upsert) to the mirror. */
  applyPatch(patch: Patch | CanvasItem[]): void {
    const p: Patch = Array.isArray(patch) ? { upsert: patch } : patch;
    const enc = this.#enc.encode(p);
    if (enc.records) this.#core.apply(enc.ops, enc.paths);
    this.#touch();
  }

  /**
   * Stores a texture under `key`: one source, or several resolutions of the same
   * image (the engine draws the smallest one at least as wide as the item on screen).
   * Sources larger than `maxTextureSide` are scaled down. Returns false when nothing fit.
   */
  setTexture(key: string, source: TextureSource | TextureSource[]): boolean {
    const list = Array.isArray(source) ? source : [source];
    const max = this.#core.max_texture_side();
    const sources: unknown[] = [];
    const sizes: number[] = [];
    for (const s of list) {
      let [w, h] = sourceSize(s);
      if (!w || !h) continue;
      let src: unknown = s;
      if (w > max || h > max) {
        const k = max / Math.max(w, h);
        [src, w, h] = [scaleDown(s, Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(h * k))), Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(h * k))];
      }
      sources.push(src);
      sizes.push(w, h);
    }
    if (!sizes.length) return false;
    const bits = this.#core.set_texture(this.#enc.textures.ensure(key), sources, new Uint32Array(sizes));
    this.#touch();
    return bits !== 0;
  }

  removeTexture(key: string): void {
    const h = this.#enc.textures.get(key);
    if (h !== undefined) this.#core.remove_texture(h);
    this.#touch();
  }

  /** Largest texture side accepted without scaling. */
  get maxTextureSide(): number {
    return this.#core.max_texture_side();
  }

  // ---------------------------------------------------------------- state

  setTool(tool: Tool): void {
    this.#core.set_tool(TOOLS[tool]);
    this.#touch();
  }

  get tool(): Tool {
    return TOOL_NAMES[this.#core.tool()] ?? 'select';
  }

  setOptions(o: Partial<EngineOptions>): void {
    const set = (k: number, v: number) => this.#core.set_option(k, v);
    const b = (v: boolean) => (v ? 1 : 0);
    if (o.minZoom !== undefined) set(OPTION.minZoom, o.minZoom);
    if (o.maxZoom !== undefined) {
      set(OPTION.maxZoom, o.maxZoom);
      this.#maxZoom = o.maxZoom;
    }
    if (o.snap !== undefined) set(OPTION.snap, b(o.snap));
    if (o.snapDistance !== undefined) set(OPTION.snapDistance, o.snapDistance);
    if (o.dragThreshold !== undefined) set(OPTION.dragThreshold, o.dragThreshold);
    if (o.hitTolerance !== undefined) set(OPTION.hitTolerance, o.hitTolerance);
    if (o.handleSize !== undefined) set(OPTION.handleSize, o.handleSize);
    if (o.settleMs !== undefined) set(OPTION.settleMs, o.settleMs);
    if (o.cameraEventMs !== undefined) set(OPTION.cameraEventMs, o.cameraEventMs);
    if (o.wheelZoom !== undefined) set(OPTION.wheelZoom, b(o.wheelZoom));
    if (o.zoomSpeed !== undefined) set(OPTION.zoomSpeed, o.zoomSpeed);
    if (o.wheelZoomMax !== undefined) set(OPTION.wheelZoomMax, o.wheelZoomMax);
    if (o.selection !== undefined) set(OPTION.selection, b(o.selection === 'controlled'));
    if (o.marquee !== undefined) set(OPTION.marquee, b(o.marquee === 'contain'));
    if (o.fadeMs !== undefined) set(OPTION.fadeMs, o.fadeMs);
    if (o.dragEvents !== undefined) set(OPTION.dragEvents, b(o.dragEvents));
    if (o.grid !== undefined) set(OPTION.grid, { none: 0, dots: 1, lines: 2 }[o.grid]);
    if (o.gridSpacing !== undefined) set(OPTION.gridSpacing, o.gridSpacing);
    if (o.gridMajor !== undefined) set(OPTION.gridMajor, o.gridMajor);
    if (o.gridFade !== undefined) {
      set(OPTION.gridFadeStart, o.gridFade[0]);
      set(OPTION.gridFadeEnd, o.gridFade[1]);
    }
    if (o.textureBudget !== undefined) set(OPTION.textureBudget, o.textureBudget);
    for (const [k, v] of Object.entries(o.theme ?? {})) {
      const key = THEME_OPTION[k as keyof typeof THEME_OPTION];
      if (key !== undefined && v !== undefined) set(key, parseColor(v));
    }
    this.#touch();
  }

  /** Replaces the selection (the way to apply a `select` commit in 'controlled' mode). No event. */
  setSelection(ids: string[]): void {
    const hs: number[] = [];
    for (const id of ids) {
      const h = this.#enc.items.get(id);
      if (h !== undefined) hs.push(h);
    }
    this.#core.set_selection(new Uint32Array(hs));
    this.#touch();
  }

  get selection(): string[] {
    return this.#enc.items.ids(this.#core.selection());
  }

  /** Other users' cursors and selections, drawn in the overlay. */
  setPeers(peers: Peer[]): void {
    const data: number[] = [];
    for (const p of peers) {
      const sel: number[] = [];
      for (const id of p.selection ?? []) {
        const h = this.#enc.items.get(id);
        if (h !== undefined) sel.push(h);
      }
      data.push(parseColor(p.color), p.cursor ? 1 : 0, p.cursor?.x ?? 0, p.cursor?.y ?? 0, sel.length, ...sel);
    }
    this.#core.set_peers(new Float64Array(data));
    this.#touch();
  }

  /** Topmost hittable item at a screen point. */
  hitTest(screen: Point): string | null {
    const h = this.#core.hit_test(screen.x, screen.y);
    return h < 0 ? null : (this.#enc.items.id(h) ?? null);
  }

  /** The resize handle of the selected item at a screen point (only handles the engine draws). */
  hitHandle(screen: Point): { id: string; handle: Handle } | null {
    const r = this.#core.hit_handle(screen.x, screen.y);
    if (r.length < 2) return null;
    const id = this.#enc.items.id(r[0]!);
    const handle = HANDLES[r[1]!];
    return id !== undefined && handle ? { id, handle } : null;
  }

  /** An item's rect as the engine has it now (mid-gesture included), or null if unknown. */
  itemRect(id: string): (Rect & { rotation: number }) | null {
    const h = this.#enc.items.get(id);
    if (h === undefined) return null;
    const r = this.#core.item_rect(h);
    return r.length < 5 ? null : { x: r[0]!, y: r[1]!, w: r[2]!, h: r[3]!, rotation: r[4]! };
  }

  /**
   * Starts moving an item (and the selection, if it is in it) from a press the host
   * received, e.g. on a DOM title above the canvas. The pointer's later moves and
   * release must reach the engine: with the DOM listeners the canvas captures the
   * pointer. It becomes a drag past the drag threshold, like a press on the item.
   * Returns false when a gesture is running, the tool is not 'select' or nothing is movable.
   */
  startMove(id: string, p: PointerInput): boolean {
    const h = this.#enc.items.get(id);
    if (h === undefined) return false;
    const ok = this.#core.start_move(p.id ?? 1, p.x, p.y, h, modsOf(flags(p)));
    if (ok && this.canvas && p.id !== undefined) {
      try {
        this.canvas.setPointerCapture(p.id);
      } catch {
        // Not an active pointer (synthetic input): moves must then be fed through `input`.
      }
    }
    this.#touch();
    return ok;
  }

  /** Items whose bounds meet a world rect. */
  queryRect(r: Rect): string[] {
    return this.#enc.items.ids(this.#core.query_rect(r.x, r.y, r.w, r.h));
  }

  /** Abandons the gesture in progress (restoring what it moved). */
  cancelGesture(): void {
    this.#core.cancel_gesture();
    this.#touch();
  }

  // ---------------------------------------------------------------- camera

  get camera(): CameraState {
    const c = this.#core.camera();
    return { x: c[0]!, y: c[1]!, zoom: c[2]! };
  }

  /** Whether the camera is moving (not yet settled). */
  get moving(): boolean {
    return this.#core.camera()[8] === 1;
  }

  setCamera(c: CameraState): void {
    this.#core.set_camera(c.x, c.y, c.zoom);
    this.#touch();
  }

  panBy(dx: number, dy: number): void {
    this.#core.pan_by(dx, dy);
    this.#touch();
  }

  /** Zooms by `factor` keeping the screen point fixed (default the centre). */
  zoomAt(factor: number, screen?: Point): void {
    const [w, h] = this.#size;
    this.#core.zoom_at(factor, screen?.x ?? w / 2, screen?.y ?? h / 2);
    this.#touch();
  }

  /** Animates the camera to frame a world rect. */
  glideTo(r: Rect, o: GlideOptions = {}): void {
    this.#core.glide_to(r.x, r.y, r.w, r.h, o.duration ?? 300, o.padding ?? 40, o.maxZoom ?? this.#maxZoom);
    this.#touch();
  }

  /** Jumps to frame a world rect. */
  fit(r: Rect, o: Omit<GlideOptions, 'duration'> = {}): void {
    this.glideTo(r, { ...o, duration: 0 });
  }

  screenToWorld(p: Point): Point {
    return screenToWorld(this.camera, p);
  }

  worldToScreen(p: Point): Point {
    return worldToScreen(this.camera, p);
  }

  /** The world rect the canvas shows. */
  viewport(): Rect {
    const [w, h] = this.#size;
    return visibleRect(this.camera, w, h);
  }

  /** Resizes the drawing surface (CSS pixels). Called automatically when listening. */
  resize(width: number, height: number, dpr = this.#dpr): void {
    this.#size = [width, height];
    this.#dpr = dpr;
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(width * dpr));
      this.canvas.height = Math.max(1, Math.round(height * dpr));
    }
    this.#core.resize(width, height, dpr);
    this.#touch();
  }

  stats(): EngineStats {
    const s = this.#core.stats();
    return {
      items: s[0]!,
      visible: s[1]!,
      drawCalls: s[2]!,
      textures: s[3]!,
      textureBytes: s[4]!,
      atlasLayers: s[5]!,
      quads: s[6]!,
      pathVertices: s[7]!,
      pathIndices: s[8]!,
      batches: s[9]!,
      holes: s[10]!,
      maxAtlasLayers: s[11]!,
      wasmMemory: this.#memory.buffer.byteLength,
    };
  }

  // ---------------------------------------------------------------- input

  /**
   * Feeds input directly (what the DOM listeners do). For tests, headless use and
   * hosts that route events themselves (with `listen: false`). Returns whether the
   * engine handled it.
   */
  readonly input = {
    pointerDown: (p: PointerInput): boolean => {
      const r = this.#core.pointer_down(p.id ?? 1, p.x, p.y, p.button ?? 0, modsOf(flags(p)), POINTER_TYPES[p.type ?? 'mouse']);
      this.#touch();
      return r;
    },
    pointerMove: (p: PointerInput): boolean => {
      const r = this.#core.pointer_move(p.id ?? 1, p.x, p.y, p.buttons ?? 0, modsOf(flags(p)));
      this.#touch();
      return r;
    },
    pointerUp: (p: PointerInput): boolean => {
      const r = this.#core.pointer_up(p.id ?? 1, p.x, p.y, p.button ?? 0, modsOf(flags(p)));
      this.#touch();
      return r;
    },
    pointerCancel: (id = 1): void => {
      this.#core.pointer_cancel(id);
      this.#touch();
    },
    pointerLeave: (): void => {
      this.#core.pointer_leave();
      this.#touch();
    },
    /** Wheel deltas in pixels. */
    wheel: (p: Point & { dx: number; dy: number; ctrl?: boolean; shift?: boolean; meta?: boolean; alt?: boolean }): boolean => {
      const r = this.#core.wheel(p.x, p.y, p.dx, p.dy, modsOf(flags(p)));
      this.#touch();
      return r;
    },
    /** A double click at a screen point: emits `dblclick` with the item under it. */
    dblclick: (p: PointerInput): void => {
      this.#core.pointer_event(0, p.x, p.y, modsOf(flags(p)));
      this.#touch();
    },
    /** A context menu request at a screen point: emits `contextmenu` with the item under it. */
    contextmenu: (p: PointerInput): void => {
      this.#core.pointer_event(1, p.x, p.y, modsOf(flags(p)));
      this.#touch();
    },
    /** 'space' | 'escape' | 'modifier'. */
    key: (key: 'space' | 'escape' | 'modifier', down: boolean, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean } = {}): boolean => {
      const code = key === 'space' ? KEY_SPACE : key === 'escape' ? KEY_ESCAPE : KEY_MODIFIER;
      const r = this.#core.key(code, down, modsOf(flags(mods)));
      this.#touch();
      return r;
    },
  };

  #canvasPoint(e: { clientX: number; clientY: number }, refresh = false): Point {
    if (refresh || !this.#rect) this.#rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - this.#rect.left, y: e.clientY - this.#rect.top };
  }

  #listen(canvas: HTMLCanvasElement): void {
    const add = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K | string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.#cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    canvas.style.touchAction = 'none';
    add(canvas, 'pointerdown', (e: PointerEvent) => {
      const p = this.#canvasPoint(e, true);
      const handled = this.#core.pointer_down(e.pointerId, p.x, p.y, e.button, modsOf(e), POINTER_TYPES[e.pointerType as 'mouse'] ?? 0);
      if (handled) {
        canvas.setPointerCapture?.(e.pointerId);
        if (e.button === 1) e.preventDefault();
      }
      this.#touch();
    });
    add(canvas, 'pointermove', (e: PointerEvent) => {
      const p = this.#canvasPoint(e);
      this.#core.pointer_move(e.pointerId, p.x, p.y, e.buttons, modsOf(e));
      this.#touch();
    });
    const up = (e: PointerEvent) => {
      const p = this.#canvasPoint(e);
      this.#core.pointer_up(e.pointerId, p.x, p.y, e.button, modsOf(e));
      this.#touch();
    };
    add(canvas, 'pointerup', up);
    add(canvas, 'pointercancel', (e: PointerEvent) => {
      this.#core.pointer_cancel(e.pointerId);
      this.#touch();
    });
    add(canvas, 'pointerleave', () => {
      this.#core.pointer_leave();
      this.#touch();
    });
    add(
      canvas,
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const p = this.#canvasPoint(e, true);
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.#size[1] : 1;
        this.#core.wheel(p.x, p.y, e.deltaX * unit, e.deltaY * unit, modsOf(e));
        this.#touch();
      },
      { passive: false },
    );
    // Safari trackpad pinch.
    let gestureScale = 1;
    add(canvas, 'gesturestart', (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    });
    add(canvas, 'gesturechange', (e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
      e.preventDefault();
      const scale = e.scale ?? 1;
      const p = this.#canvasPoint({ clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 });
      this.#core.zoom_at(scale / gestureScale, p.x, p.y);
      gestureScale = scale;
      this.#touch();
    });
    const pointerEvent = (kind: number) => (e: MouseEvent) => {
      const p = this.#canvasPoint(e, true);
      this.#domEvent = e;
      this.#core.pointer_event(kind, p.x, p.y, modsOf(e));
      try {
        this.#touch();
      } finally {
        this.#domEvent = undefined;
      }
    };
    add(canvas, 'dblclick', pointerEvent(0));
    add(canvas, 'contextmenu', (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
      else pointerEvent(1)(e);
    });
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      let handled = false;
      if (e.code === 'Space') {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        handled = this.#core.key(KEY_SPACE, down, modsOf(e));
      } else if (e.key === 'Escape' && down) handled = this.#core.key(KEY_ESCAPE, true, modsOf(e));
      else if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) this.#core.key(KEY_MODIFIER, down, modsOf(e));
      if (handled) e.preventDefault();
      this.#touch();
    };
    add(window, 'keydown', key(true));
    add(window, 'keyup', key(false));
    add(window, 'blur', () => {
      this.#core.key(KEY_SPACE, false, 0);
      this.#touch();
    });
    add(window, 'scroll', () => (this.#rect = null), { capture: true, passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(entries => {
        const box = entries[0]!.contentRect;
        this.#rect = null;
        if (box.width !== this.#size[0] || box.height !== this.#size[1]) this.resize(box.width, box.height, devicePixelRatio || 1);
      });
      ro.observe(canvas);
      this.#cleanup.push(() => ro.disconnect());
    }
    const watchDpr = () => {
      const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      const onChange = () => {
        this.resize(this.#size[0], this.#size[1], devicePixelRatio || 1);
        watchDpr();
      };
      mq.addEventListener('change', onChange, { once: true });
      this.#cleanup.push(() => mq.removeEventListener('change', onChange));
    };
    if (typeof matchMedia === 'function') watchDpr();
    add(canvas, 'webglcontextlost', (e: Event) => {
      e.preventDefault();
      this.#lost = true;
      this.#core.context_lost();
      this.#emit('contextlost', {});
    });
    add(canvas, 'webglcontextrestored', () => {
      const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
      if (!gl) return;
      this.#core.context_restored(gl);
      this.#lost = false;
      this.#touch();
    });
  }

  /** Stops listening and frees the engine. The canvas keeps its last frame. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    for (const fn of this.#cleanup) fn();
    this.#cleanup.length = 0;
    this.#listeners.clear();
    this.#core.free();
  }
}

function flags(p: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean }) {
  return { shiftKey: !!p.shift, altKey: !!p.alt, ctrlKey: !!p.ctrl, metaKey: !!p.meta };
}

/** Draws a source into a smaller canvas. */
function scaleDown(s: TextureSource, w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  const c: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (typeof ImageData !== 'undefined' && s instanceof ImageData) {
    const tmp = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(s.width, s.height) : Object.assign(document.createElement('canvas'), { width: s.width, height: s.height });
    (tmp.getContext('2d') as CanvasRenderingContext2D).putImageData(s, 0, 0);
    ctx.drawImage(tmp as CanvasImageSource, 0, 0, w, h);
  } else ctx.drawImage(s as CanvasImageSource, 0, 0, w, h);
  return c;
}
