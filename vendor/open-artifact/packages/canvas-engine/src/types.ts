/**
 * Public types of the canvas engine. Coordinates are world units unless named
 * `screen` (CSS pixels relative to the canvas' top-left corner). Rotation is in
 * radians, clockwise, about the item's centre.
 */

/**
 * A colour: a CSS colour (named, `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`,
 * `hsl()`/`hsla()`, `transparent`; not `currentColor`, `var()` or newer spaces), `none`,
 * or a 0xRRGGBBAA number.
 */
export type Color = string | number;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Behaviour flags. Defaults: visible, hittable, selectable, movable, resizable, snap
 * target, hover and selection outline are on, all handles show, normal blending;
 * lockAspect, hitStrokeOnly and screenStroke are off.
 */
export interface ItemFlags {
  visible?: boolean;
  /** Found by hit tests and hover. */
  hittable?: boolean;
  /** Clicking or marquee selects it. */
  selectable?: boolean;
  /** Dragging it moves it (and emits a `move` commit). */
  movable?: boolean;
  /** Shows resize handles when it is the only selected item. */
  resizable?: boolean;
  /** Other items snap to its edges and centre. */
  snap?: boolean;
  /** Resizing keeps the aspect ratio (as Shift does). */
  lockAspect?: boolean;
  /** Only the stroke is hit, not the fill (outlines, connectors). */
  hitStrokeOnly?: boolean;
  /** Stroke width and dashes are in screen pixels, not world units. */
  screenStroke?: boolean;
  /** Draws the hover outline when the pointer is over it. */
  hover?: boolean;
  /** Draws the selection outline and handles when selected (it still counts in the group box). */
  selectionOutline?: boolean;
  /** Which resize handles show: all eight, the four corners, or the left and right edges only. */
  handles?: 'all' | 'corners' | 'width';
  /** 'multiply' darkens what is below (ink on paper). Items blending differently draw in separate batches. */
  blend?: 'normal' | 'multiply';
}

interface ItemBase extends ItemFlags {
  /** Stable id, unique across the engine. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  /** Draw order: by layer, then z, then insertion order. */
  layer?: number;
  z?: number;
  /** 0..1, default 1. */
  opacity?: number;
}

export interface Shadow {
  color: Color;
  blur: number;
  dx?: number;
  dy?: number;
}

/** A rounded rectangle, optionally textured (an image, a rendered artboard, text). */
export interface RectItem extends ItemBase {
  kind: 'rect' | 'image';
  /** Fill; for a textured rect, the placeholder shown until the texture arrives. */
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
  radius?: number;
  /** Stroke dash [on, off]. */
  dash?: [number, number];
  shadow?: Shadow;
  /** Texture key (see `CanvasEngine.setTexture`); missing keys are asked for with `textureNeeded`. */
  texture?: string;
}

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

/**
 * A vector path in the item's box. Geometry is either SVG path data (`d`) or a
 * polyline (`points`, flat [x0, y0, x1, y1, …]). Coordinates are relative to the
 * box's top-left corner, or to `viewBox` (scaled to fill the box) when given.
 */
export interface PathItem extends ItemBase {
  kind: 'path';
  d?: string;
  points?: ArrayLike<number>;
  /** Close the polyline. */
  closed?: boolean;
  viewBox?: [number, number];
  fill?: Color;
  fillRule?: 'nonzero' | 'evenodd';
  stroke?: Color;
  strokeWidth?: number;
  cap?: LineCap;
  join?: LineJoin;
  miterLimit?: number;
  dash?: [number, number];
  /**
   * Up to two rects (in path coordinates) where the path is not drawn, e.g. the gap
   * a connector leaves for its label.
   */
  cuts?: Rect[];
}

/**
 * A transparent cut-out: whatever the engine draws below it is not drawn, so DOM
 * content placed under the canvas shows through. Items above it still draw on top.
 * Visible holes are reported with the `holes` event, in screen space.
 */
export interface HoleItem extends ItemBase {
  kind: 'hole';
  radius?: number;
}

export type CanvasItem = RectItem | PathItem | HoleItem;

/** A change to the engine's mirror. Upserts replace the whole item. */
export interface Patch {
  /** Remove everything first. */
  clear?: boolean;
  remove?: string[];
  upsert?: CanvasItem[];
}

/** An image the engine can upload. */
export type TextureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageData;

export type Tool = 'select' | 'pan' | 'none';

export interface Theme {
  background: Color;
  grid: Color;
  selection: Color;
  handle: Color;
  guide: Color;
  marquee: Color;
  hover: Color;
}

export interface EngineOptions {
  minZoom: number;
  maxZoom: number;
  /** Snap moves and resizes to other items' edges and centres (Ctrl/Cmd disables while held). */
  snap: boolean;
  /** Snap distance in screen pixels. */
  snapDistance: number;
  /** Pointer travel (px) before a press becomes a drag. */
  dragThreshold: number;
  /** Hit tolerance (px). */
  hitTolerance: number;
  /** Resize handle size (px). */
  handleSize: number;
  /** Quiet time (ms) after which the camera counts as settled. */
  settleMs: number;
  /** Minimum interval (ms) between `camera` events while it moves. */
  cameraEventMs: number;
  /** Plain wheel zooms (instead of panning). */
  wheelZoom: boolean;
  /** Wheel zoom sensitivity per delta unit (px): one event zooms by `exp(-deltaY × zoomSpeed)`. */
  zoomSpeed: number;
  /** The largest zoom factor one wheel event applies (zooming out, its inverse); default 1.35, `Infinity` for none. */
  wheelZoomMax: number;
  /**
   * 'engine': the engine applies selection changes and reports `selection`.
   * 'controlled': it only proposes them (`commit` with op 'select'); call `setSelection`.
   */
  selection: 'engine' | 'controlled';
  /** Marquee selects items it touches ('intersect') or fully contains ('contain'). */
  marquee: 'intersect' | 'contain';
  /** Texture fade-in (ms); 0 disables. */
  fadeMs: number;
  /** Emit `dragging` on every pointer move of a drag (e.g. to reroute connectors). */
  dragEvents: boolean;
  grid: 'none' | 'dots' | 'lines';
  /** Grid spacing in world units at the finest level. */
  gridSpacing: number;
  /** Each coarser grid level is this many times the previous one (lines grid: every n-th line is major). Default 5. */
  gridMajor: number;
  /** A level fades in between these on-screen spacings (px). Default [8, 16]. */
  gridFade: [number, number];
  /** GPU memory the texture atlas may use, in bytes (least recently used textures are evicted beyond it). */
  textureBudget: number;
  theme: Partial<Theme>;
}

export interface CameraState {
  /** World point at the canvas' top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

export interface GlideOptions {
  /** ms, default 300; 0 jumps. */
  duration?: number;
  /** Screen padding around the rect (px), default 40. */
  padding?: number;
  /** Zoom cap for the fit, default the engine's max zoom. */
  maxZoom?: number;
}

/** A visible hole in screen space, with a CSS transform that places a world-sized element over it. */
export interface HoleRect {
  id: string;
  /** Screen position of the unrotated box's top-left corner. */
  x: number;
  y: number;
  /** Screen size. */
  w: number;
  h: number;
  rotation: number;
  zoom: number;
  /**
   * `matrix(...)` for an element of the item's world size with `transform-origin: 0 0`,
   * positioned at the canvas' top-left: it covers the hole exactly (rotation included).
   */
  transform: string;
}

/** Modifier keys held when an event happened. */
export interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

/** Which handle: a corner or an edge midpoint, by compass direction. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type CommitIntent = (
  | { op: 'move'; ids: string[]; dx: number; dy: number }
  | { op: 'resize'; id: string; rect: Rect }
  | { op: 'select'; ids: string[] }
) & { modifiers: Modifiers };

/** A double click or context menu on the canvas: the item under it (if any) and where. */
export interface PointerItemEvent {
  id: string | null;
  world: Point;
  screen: Point;
  modifiers: Modifiers;
  /** The DOM event, when it came from one (to `preventDefault` it). */
  event?: MouseEvent;
}

export type GestureKind = 'move' | 'resize' | 'marquee' | 'pan' | 'pinch';

export interface CanvasEvents {
  /** The selection changed ('engine' selection mode). */
  selection: { ids: string[]; modifiers: Modifiers };
  /** The camera moved (throttled), and once more with `settled` when it stops. */
  camera: CameraState & { settled: boolean };
  /** The camera started or stopped moving. */
  moving: { moving: boolean };
  /** Visible holes changed (sent at most once per frame). */
  holes: { holes: HoleRect[] };
  /** A finished gesture the document should apply. The mirror already shows the result. */
  commit: CommitIntent;
  /** Textures the engine wants: visible items whose key it does not hold. Asked once until evicted. */
  textureNeeded: { keys: string[] };
  hover: { id: string | null };
  gesture: { kind: GestureKind; phase: 'start' | 'end' | 'cancel'; modifiers: Modifiers };
  /** During a drag, when `dragEvents` is on. */
  dragging: { ids: string[]; dx: number; dy: number; modifiers: Modifiers };
  /** During a resize, when `dragEvents` is on: the rect the item has now. */
  resizing: { id: string; rect: Rect; modifiers: Modifiers };
  dblclick: PointerItemEvent;
  contextmenu: PointerItemEvent;
  /** After each drawn frame: time spent in the engine for it (ms). */
  frame: { engineMs: number };
  contextlost: Record<string, never>;
  contextrestored: Record<string, never>;
}

export type CanvasEventName = keyof CanvasEvents;

export interface Peer {
  color: Color;
  /** World position of their pointer. */
  cursor?: Point | null;
  selection?: string[];
}

export interface EngineStats {
  items: number;
  /** Items in the viewport at the last visibility pass. */
  visible: number;
  /** Draw calls in the last frame. */
  drawCalls: number;
  textures: number;
  textureBytes: number;
  atlasLayers: number;
  maxAtlasLayers: number;
  quads: number;
  pathVertices: number;
  pathIndices: number;
  batches: number;
  holes: number;
  /** Size of the wasm linear memory (bytes). */
  wasmMemory: number;
}

export interface CreateOptions extends Partial<EngineOptions> {
  /** Device pixel ratio (default window.devicePixelRatio). */
  dpr?: number;
  /** Attach pointer, wheel, keyboard and resize listeners (default true). */
  listen?: boolean;
  /** Initial tool (default 'select'). */
  tool?: Tool;
}

/** Pointer input for `CanvasEngine.input` (tests and custom event routing). Coordinates are screen. */
export interface PointerInput {
  id?: number;
  x: number;
  y: number;
  button?: number;
  buttons?: number;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  type?: 'mouse' | 'pen' | 'touch';
}
