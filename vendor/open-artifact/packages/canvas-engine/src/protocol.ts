/**
 * The binary protocol between TypeScript and the wasm core: id handles, colours,
 * path commands and patch records. Everything here is GPU-free and runs in Node.
 *
 * A patch is a Float64Array of REC-sized records plus a Float32Array of path
 * commands. Record layout (index: field):
 *   0 op (1 upsert, 2 remove, 3 clear)   1 handle   2 kind (0 box, 1 hole, 2 path)
 *   3 layer  4 z  5 x  6 y  7 w  8 h  9 rotation  10 flags  11 opacity
 *   12 fill  13 stroke (0xRRGGBBAA)  14 stroke width  15 radius  16 dash on  17 dash off
 *   18 shadow colour  19 shadow blur  20 shadow dx  21 shadow dy  22 texture handle (-1 none)
 *   23 path offset  24 path length  25 viewBox w  26 viewBox h  27 cap  28 join  29 miter limit
 *   30 fill rule  31 reserved
 * Path commands (f32): 0 M x y, 1 L x y, 2 Q cx cy x y, 3 C c1x c1y c2x c2y x y, 4 Z.
 */

import type { CanvasItem, Color, ItemFlags, Patch, PathItem } from './types.ts';

export const REC = 32;
export const OP_UPSERT = 1;
export const OP_REMOVE = 2;
export const OP_CLEAR = 3;

export const KIND_BOX = 0;
export const KIND_HOLE = 1;
export const KIND_PATH = 2;

export const F_VISIBLE = 1;
export const F_HITTABLE = 2;
export const F_SELECTABLE = 4;
export const F_MOVABLE = 8;
export const F_RESIZABLE = 16;
export const F_SNAP = 32;
export const F_LOCK_ASPECT = 64;
export const F_HIT_STROKE_ONLY = 128;
export const F_STROKE_SCREEN = 256;
export const F_NO_HOVER = 512;
export const F_NO_OUTLINE = 1024;
export const F_HANDLES_CORNERS = 2048;
export const F_HANDLES_WIDTH = 4096;
export const F_MULTIPLY = 8192;

/** Most cut-out rects a path takes (`PathItem.cuts`). */
export const MAX_CUTS = 2;

export const CMD_M = 0;
export const CMD_L = 1;
export const CMD_Q = 2;
export const CMD_C = 3;
export const CMD_Z = 4;

/** Option keys for `CanvasCore.set_option`. */
export const OPTION = {
  minZoom: 1,
  maxZoom: 2,
  snap: 3,
  snapDistance: 4,
  dragThreshold: 5,
  hitTolerance: 6,
  handleSize: 7,
  settleMs: 8,
  cameraEventMs: 9,
  wheelZoom: 10,
  selection: 11,
  marquee: 12,
  fadeMs: 13,
  dragEvents: 14,
  grid: 15,
  gridSpacing: 16,
  textureBudget: 17,
  zoomSpeed: 18,
  wheelZoomMax: 19,
  gridMajor: 20,
  gridFadeStart: 21,
  gridFadeEnd: 22,
} as const;

export const THEME_OPTION = {
  background: 30,
  grid: 31,
  selection: 32,
  handle: 33,
  guide: 34,
  marquee: 35,
  hover: 36,
} as const;

export const MOD_SHIFT = 1;
export const MOD_ALT = 2;
export const MOD_CTRL = 4;
export const MOD_META = 8;

export const KEY_SPACE = 1;
export const KEY_ESCAPE = 2;
export const KEY_MODIFIER = 3;

export const TOOLS = { select: 0, pan: 1, none: 2 } as const;
export const POINTER_TYPES = { mouse: 0, pen: 1, touch: 2 } as const;

/** Engine cursor codes → CSS cursors. */
export const CURSORS = ['default', 'grab', 'grabbing', 'move', 'ns-resize', 'ew-resize', 'nwse-resize', 'nesw-resize', 'crosshair'];

export const FRAME_RENDER = 1;
export const FRAME_MORE = 2;
export const FRAME_HOLES = 4;

/** CSS named colours (CSS Color 4), 0xRRGGBB. */
const NAMED: Record<string, number> = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4, azure: 0xf0ffff,
  beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd, blue: 0x0000ff,
  blueviolet: 0x8a2be2, brown: 0xa52a2a, burlywood: 0xdeb887, cadetblue: 0x5f9ea0, chartreuse: 0x7fff00,
  chocolate: 0xd2691e, coral: 0xff7f50, cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c,
  cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b, darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9,
  darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b, darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00, darkorchid: 0x9932cc, darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f, darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3, deeppink: 0xff1493, deepskyblue: 0x00bfff, dimgray: 0x696969, dimgrey: 0x696969,
  dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22, fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080,
  green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4,
  indianred: 0xcd5c5c, indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6, lightcoral: 0xf08080,
  lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2, lightgray: 0xd3d3d3, lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3, lightpink: 0xffb6c1, lightsalmon: 0xffa07a, lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa, lightslategray: 0x778899, lightslategrey: 0x778899, lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff,
  maroon: 0x800000, mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db, mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee, mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585, midnightblue: 0x191970, mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1, moccasin: 0xffe4b5, navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6,
  olive: 0x808000, olivedrab: 0x6b8e23, orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093,
  papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd,
  powderblue: 0xb0e0e6, purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000, rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1, saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
  seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd,
  slategray: 0x708090, slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f, steelblue: 0x4682b4,
  tan: 0xd2b48c, teal: 0x008080, thistle: 0xd8bfd8, tomato: 0xff6347, turquoise: 0x40e0d0, violet: 0xee82ee,
  wheat: 0xf5deb3, white: 0xffffff, whitesmoke: 0xf5f5f5, yellow: 0xffff00, yellowgreen: 0x9acd32,
};

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/;

/** One numeric CSS token: its value and unit ('%', 'deg', '' …), or null when it is not a number. */
function numeric(token: string): { v: number; unit: string } | null {
  const m = NUMBER.exec(token);
  if (!m) return null;
  const unit = token.slice(m[0].length);
  return /^(%|deg|rad|grad|turn)?$/.test(unit) ? { v: parseFloat(m[0]), unit } : null;
}

/**
 * The arguments of `fn(…)` in legacy (comma) or modern (space, `/ alpha`)
 * syntax: three channel tokens and an optional alpha token. `none` reads as 0.
 */
function colorArgs(body: string): [string, string, string, string | undefined] | null {
  const comma = body.includes(',');
  const [main, alpha, extra] = comma ? [body, undefined, undefined] : body.split('/');
  if (extra !== undefined) return null;
  const parts = main!.split(comma ? ',' : /\s+/).map(p => p.trim()).filter(Boolean);
  if (comma ? parts.length !== 3 && parts.length !== 4 : parts.length !== 3) return null;
  const a = comma ? parts[3] : alpha?.trim();
  if (a === '') return null;
  const none = (p: string) => (p === 'none' ? '0' : p);
  return [none(parts[0]!), none(parts[1]!), none(parts[2]!), a === undefined ? undefined : none(a)];
}

/** An alpha token (number or percentage) as 0–1. */
function alphaOf(token: string | undefined): number {
  if (token === undefined) return 1;
  const n = numeric(token);
  if (!n || (n.unit && n.unit !== '%')) return NaN;
  return n.unit === '%' ? n.v / 100 : n.v;
}

/** A hue token in degrees. */
function hueOf(token: string): number {
  const n = numeric(token);
  if (!n) return NaN;
  switch (n.unit) {
    case '':
    case 'deg':
      return n.v;
    case 'rad':
      return (n.v * 180) / Math.PI;
    case 'grad':
      return n.v * 0.9;
    case 'turn':
      return n.v * 360;
    default:
      return NaN;
  }
}

/** A percentage (or plain number in modern syntax) as 0–1. */
function fractionOf(token: string): number {
  const n = numeric(token);
  if (!n) return NaN;
  if (n.unit === '%') return n.v / 100;
  return n.unit === '' ? n.v / 100 : NaN;
}

/** Packs 0–255 channels and a 0–1 alpha into 0xRRGGBBAA, clamping each. */
function pack(r: number, g: number, b: number, a: number): number {
  const q = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), max));
  return ((q(r, 255) << 24) | (q(g, 255) << 16) | (q(b, 255) << 8) | q(a * 255, 255)) >>> 0;
}

/** HSL (hue in degrees, saturation and lightness 0–1) → 0–255 RGB (CSS Color 4 algorithm). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * Parses a colour to 0xRRGGBBAA (unsigned). Reads numbers (already packed),
 * every CSS named colour, `transparent`, `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`,
 * and `rgb()`/`rgba()`/`hsl()`/`hsla()` in comma or space syntax with
 * percentages, hue units and `/ alpha`. In a browser, other colour spaces
 * and `color-mix()` are resolved by painting them ({@link paintedColor}).
 * Throws on anything else (`currentColor`, `var()`, and any of those outside
 * a browser).
 */
export function parseColor(c: Color | undefined | null, fallback = 0): number {
  if (c === undefined || c === null) return fallback;
  if (typeof c === 'number') return c >>> 0;
  const s = c.trim().toLowerCase();
  if (s === 'transparent' || s === 'none') return 0;
  const named = NAMED[s];
  if (named !== undefined) return ((named << 8) | 0xff) >>> 0;
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (/^[0-9a-f]+$/.test(h)) {
      if (h.length === 3 || h.length === 4) {
        const full = [...h].map(ch => ch + ch).join('');
        return parseInt(h.length === 3 ? full + 'ff' : full, 16) >>> 0;
      }
      if (h.length === 6) return parseInt(h + 'ff', 16) >>> 0;
      if (h.length === 8) return parseInt(h, 16) >>> 0;
    }
  }
  const m = /^(rgba?|hsla?)\(\s*([^()]*)\)$/.exec(s);
  const args = m ? colorArgs(m[2]!) : null;
  if (m && args) {
    const [x, y, z, alpha] = args;
    const a = alphaOf(alpha);
    if (m[1]!.startsWith('rgb')) {
      const channel = (p: string) => {
        const n = numeric(p);
        return !n ? NaN : n.unit === '%' ? (n.v / 100) * 255 : n.unit === '' ? n.v : NaN;
      };
      const rgb = [channel(x), channel(y), channel(z)] as const;
      if ([...rgb, a].every(Number.isFinite)) return pack(rgb[0], rgb[1], rgb[2], a);
    } else {
      const h = hueOf(x);
      const sat = Math.min(Math.max(fractionOf(y), 0), 1);
      const light = Math.min(Math.max(fractionOf(z), 0), 1);
      if ([h, sat, light, a].every(Number.isFinite)) {
        const [r, g, b] = hslToRgb(h, sat, light);
        return pack(r, g, b, a);
      }
    }
  }
  const painted = paintedColor(s);
  if (painted !== null) return painted;
  throw new TypeError(`canvas-engine: unsupported colour ${JSON.stringify(c)}`);
}

let probe: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
const paintedCache = new Map<string, number | null>();

/**
 * Colours the parser does not read itself (`oklch()`, `lab()`, `color()`,
 * `color-mix()`, …), resolved by the browser: painted into a 1×1 canvas and
 * read back as sRGB. Null outside a browser, or when the browser rejects it.
 */
function paintedColor(css: string): number | null {
  const cached = paintedCache.get(css);
  if (cached !== undefined) return cached;
  if (probe === undefined) {
    probe =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
        : typeof document !== 'undefined'
          ? document.createElement('canvas').getContext('2d', { willReadFrequently: true })
          : null;
  }
  let value: number | null = null;
  if (probe) {
    // A colour the browser rejects leaves fillStyle unchanged: test it against two sentinels.
    probe.fillStyle = '#000';
    probe.fillStyle = css;
    const first = probe.fillStyle;
    probe.fillStyle = '#fff';
    probe.fillStyle = css;
    if (first === probe.fillStyle) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      // getImageData is unpremultiplied; alpha 0 reads as transparent black.
      value = a === 0 ? 0 : (((r! << 24) | (g! << 16) | (b! << 8) | a!) >>> 0);
    }
  }
  if (paintedCache.size > 512) paintedCache.clear();
  paintedCache.set(css, value);
  return value;
}

/** Behaviour flags with their defaults. */
export function encodeFlags(f: ItemFlags): number {
  let v = 0;
  if (f.visible !== false) v |= F_VISIBLE;
  if (f.hittable !== false) v |= F_HITTABLE;
  if (f.selectable !== false) v |= F_SELECTABLE;
  if (f.movable !== false) v |= F_MOVABLE;
  if (f.resizable !== false) v |= F_RESIZABLE;
  if (f.snap !== false) v |= F_SNAP;
  if (f.lockAspect) v |= F_LOCK_ASPECT;
  if (f.hitStrokeOnly) v |= F_HIT_STROKE_ONLY;
  if (f.screenStroke) v |= F_STROKE_SCREEN;
  if (f.hover === false) v |= F_NO_HOVER;
  if (f.selectionOutline === false) v |= F_NO_OUTLINE;
  if (f.handles === 'corners') v |= F_HANDLES_CORNERS;
  else if (f.handles === 'width') v |= F_HANDLES_WIDTH;
  if (f.blend === 'multiply') v |= F_MULTIPLY;
  return v;
}

// ------------------------------------------------------------------ SVG path data

/** Splits path data into command letters and numbers (handles `1e-3`, `.5.5`, `-1-2`, arc flags `11`). */
function tokens(d: string): { cmd: boolean; raw: string }[] {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const out: { cmd: boolean; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ? { cmd: true, raw: m[1] } : { cmd: false, raw: m[2]! });
  return out;
}

/** Arc parameters to cubic Béziers (SVG implementation notes, F.6). Pushes C commands. */
function arcToCubics(out: number[], x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number) {
  if (rx === 0 || ry === 0) {
    out.push(CMD_L, x2, y2);
    return;
  }
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  let t = theta1;
  const point = (a: number) => {
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey] as const;
  };
  const deriv = (a: number) => {
    const ex = -rx * Math.sin(a);
    const ey = ry * Math.cos(a);
    return [cos * ex - sin * ey, sin * ex + cos * ey] as const;
  };
  for (let i = 0; i < segments; i++) {
    const t2 = t + step;
    const [px, py] = point(t);
    const [qx, qy] = point(t2);
    const [d1x, d1y] = deriv(t);
    const [d2x, d2y] = deriv(t2);
    out.push(CMD_C, px + k * d1x, py + k * d1y, qx - k * d2x, qy - k * d2y, i === segments - 1 ? x2 : qx, i === segments - 1 ? y2 : qy);
    t = t2;
  }
}

/**
 * SVG path data → engine path commands (absolute M/L/Q/C/Z). Supports every SVG
 * command, relative forms and implicit repeats; arcs become cubics.
 */
export function parseSvgPath(d: string): number[] {
  const out: number[] = [];
  const toks = tokens(d);
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  // Last control point for S/T reflection, and which kind it came from.
  let cx = 0;
  let cy = 0;
  let last = '';
  const num = (): number => {
    const v = toks[i];
    if (!v || v.cmd) throw new SyntaxError(`canvas-engine: bad path data near token ${i} in ${JSON.stringify(d.slice(0, 80))}`);
    i++;
    return parseFloat(v.raw);
  };
  // Arc flags are single characters and may run into what follows ("a1 1 0 012 0").
  const flag = (): boolean => {
    const v = toks[i];
    if (!v || v.cmd || (v.raw[0] !== '0' && v.raw[0] !== '1')) throw new SyntaxError(`canvas-engine: bad arc flag near token ${i}`);
    if (v.raw.length > 1) toks[i] = { cmd: false, raw: v.raw.slice(1) };
    else i++;
    return v.raw[0] === '1';
  };
  while (i < toks.length) {
    const t = toks[i]!;
    if (t.cmd) {
      cmd = t.raw;
      i++;
    } else if (!cmd) {
      throw new SyntaxError('canvas-engine: path data must start with a command');
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        out.push(CMD_M, x, y);
        cmd = rel ? 'l' : 'L';
        last = 'M';
        break;
      }
      case 'L':
        x = ox + num();
        y = oy + num();
        out.push(CMD_L, x, y);
        last = 'L';
        break;
      case 'H':
        x = ox + num();
        out.push(CMD_L, x, y);
        last = 'L';
        break;
      case 'V':
        y = oy + num();
        out.push(CMD_L, x, y);
        last = 'L';
        break;
      case 'C': {
        const c1x = ox + num();
        const c1y = oy + num();
        cx = ox + num();
        cy = oy + num();
        x = ox + num();
        y = oy + num();
        out.push(CMD_C, c1x, c1y, cx, cy, x, y);
        last = 'C';
        break;
      }
      case 'S': {
        const c1x = last === 'C' ? 2 * x - cx : x;
        const c1y = last === 'C' ? 2 * y - cy : y;
        cx = ox + num();
        cy = oy + num();
        x = ox + num();
        y = oy + num();
        out.push(CMD_C, c1x, c1y, cx, cy, x, y);
        last = 'C';
        break;
      }
      case 'Q':
        cx = ox + num();
        cy = oy + num();
        x = ox + num();
        y = oy + num();
        out.push(CMD_Q, cx, cy, x, y);
        last = 'Q';
        break;
      case 'T':
        cx = last === 'Q' ? 2 * x - cx : x;
        cy = last === 'Q' ? 2 * y - cy : y;
        x = ox + num();
        y = oy + num();
        out.push(CMD_Q, cx, cy, x, y);
        last = 'Q';
        break;
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const nx = ox + num();
        const ny = oy + num();
        arcToCubics(out, x, y, rx, ry, rot, large, sweep, nx, ny);
        x = nx;
        y = ny;
        last = 'A';
        break;
      }
      case 'Z':
        out.push(CMD_Z);
        x = sx;
        y = sy;
        last = 'Z';
        // A number after Z continues with an implicit command it does not allow.
        if (toks[i] && !toks[i]!.cmd) throw new SyntaxError('canvas-engine: numbers after Z in path data');
        break;
      default:
        throw new SyntaxError(`canvas-engine: unknown path command ${cmd}`);
    }
  }
  return out;
}

/** A polyline ([x0, y0, x1, y1, …]) → engine path commands. */
export function polylineCommands(points: ArrayLike<number>, closed = false): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push(i === 0 ? CMD_M : CMD_L, points[i]!, points[i + 1]!);
  if (closed && out.length) out.push(CMD_Z);
  return out;
}

// ------------------------------------------------------------------ ids

/** String ids ↔ u32 handles. Freed handles are reused only after `flush` (the end of a patch). */
export class IdRegistry {
  #handles = new Map<string, number>();
  #ids: (string | undefined)[] = [];
  #free: number[] = [];
  #pending: number[] = [];

  get size(): number {
    return this.#handles.size;
  }

  get(id: string): number | undefined {
    return this.#handles.get(id);
  }

  /** The handle for `id`, assigning one if it has none. */
  ensure(id: string): number {
    let h = this.#handles.get(id);
    if (h === undefined) {
      h = this.#free.pop() ?? this.#ids.length;
      this.#handles.set(id, h);
      this.#ids[h] = id;
    }
    return h;
  }

  id(handle: number): string | undefined {
    return this.#ids[handle];
  }

  ids(handles: ArrayLike<number>): string[] {
    const out: string[] = [];
    for (let i = 0; i < handles.length; i++) {
      const id = this.#ids[handles[i]!];
      if (id !== undefined) out.push(id);
    }
    return out;
  }

  release(id: string): number | undefined {
    const h = this.#handles.get(id);
    if (h === undefined) return undefined;
    this.#handles.delete(id);
    this.#ids[h] = undefined;
    this.#pending.push(h);
    return h;
  }

  clear(): void {
    for (const h of this.#handles.values()) this.#pending.push(h);
    this.#handles.clear();
    this.#ids.fill(undefined);
  }

  /** Makes released handles reusable. */
  flush(): void {
    this.#free.push(...this.#pending);
    this.#pending.length = 0;
  }
}

// ------------------------------------------------------------------ patches

const CAPS = { butt: 0, round: 1, square: 2 } as const;
const JOINS = { miter: 0, round: 1, bevel: 2 } as const;

/** Parsed path commands per item, reused while its geometry input is the same. */
interface PathCacheEntry {
  d: string | undefined;
  points: ArrayLike<number> | undefined;
  closed: boolean;
  cmds: number[];
}

export interface EncodedPatch {
  ops: Float64Array;
  paths: Float32Array;
  records: number;
}

/** Encodes patches; keeps the id registries and a per-item path parse cache. */
export class PatchEncoder {
  readonly items = new IdRegistry();
  readonly textures = new IdRegistry();
  #pathCache = new Map<string, PathCacheEntry>();

  #commands(item: PathItem): number[] {
    const prev = this.#pathCache.get(item.id);
    const closed = item.closed ?? false;
    if (prev && prev.d === item.d && prev.points === item.points && prev.closed === closed) return prev.cmds;
    const cmds = item.d !== undefined ? parseSvgPath(item.d) : item.points ? polylineCommands(item.points, closed) : [];
    this.#pathCache.set(item.id, { d: item.d, points: item.points, closed, cmds });
    return cmds;
  }

  encode(patch: Patch): EncodedPatch {
    const upserts = patch.upsert ?? [];
    const removes = patch.remove ?? [];
    const n = (patch.clear ? 1 : 0) + removes.length + upserts.length;
    const ops = new Float64Array(n * REC);
    const pathChunks: number[][] = [];
    let pathLen = 0;
    let r = 0;
    if (patch.clear) {
      ops[0] = OP_CLEAR;
      this.items.clear();
      this.#pathCache.clear();
      r = 1;
    }
    for (const id of removes) {
      const h = this.items.release(id);
      this.#pathCache.delete(id);
      if (h === undefined) continue;
      const o = r * REC;
      ops[o] = OP_REMOVE;
      ops[o + 1] = h;
      r++;
    }
    for (const item of upserts) {
      const o = r * REC;
      r++;
      ops[o] = OP_UPSERT;
      ops[o + 1] = this.items.ensure(item.id);
      ops[o + 3] = item.layer ?? 0;
      ops[o + 4] = item.z ?? 0;
      ops[o + 5] = item.x;
      ops[o + 6] = item.y;
      ops[o + 7] = item.w;
      ops[o + 8] = item.h;
      ops[o + 9] = item.rotation ?? 0;
      ops[o + 10] = encodeFlags(item);
      ops[o + 11] = item.opacity ?? 1;
      ops[o + 22] = -1;
      switch (item.kind) {
        case 'hole':
          ops[o + 2] = KIND_HOLE;
          ops[o + 15] = item.radius ?? 0;
          break;
        case 'path': {
          ops[o + 2] = KIND_PATH;
          ops[o + 12] = parseColor(item.fill);
          ops[o + 13] = parseColor(item.stroke);
          ops[o + 14] = item.strokeWidth ?? 1;
          ops[o + 16] = item.dash?.[0] ?? 0;
          ops[o + 17] = item.dash?.[1] ?? 0;
          const cmds = this.#commands(item);
          ops[o + 23] = pathLen;
          ops[o + 24] = cmds.length;
          pathChunks.push(cmds);
          pathLen += cmds.length;
          // Cut-out rects follow the commands in the path stream; their count is the record's last slot.
          const cuts = item.cuts?.slice(0, MAX_CUTS) ?? [];
          if (cuts.length) {
            const flat = cuts.flatMap(c => [c.x, c.y, c.w, c.h]);
            pathChunks.push(flat);
            pathLen += flat.length;
            ops[o + 31] = cuts.length;
          }
          ops[o + 25] = item.viewBox?.[0] ?? 0;
          ops[o + 26] = item.viewBox?.[1] ?? 0;
          ops[o + 27] = CAPS[item.cap ?? 'butt'];
          ops[o + 28] = JOINS[item.join ?? 'miter'];
          ops[o + 29] = item.miterLimit ?? 4;
          ops[o + 30] = item.fillRule === 'evenodd' ? 1 : 0;
          break;
        }
        default: {
          ops[o + 2] = KIND_BOX;
          ops[o + 12] = parseColor(item.fill);
          ops[o + 13] = parseColor(item.stroke);
          ops[o + 14] = item.strokeWidth ?? (item.stroke !== undefined ? 1 : 0);
          ops[o + 15] = item.radius ?? 0;
          ops[o + 16] = item.dash?.[0] ?? 0;
          ops[o + 17] = item.dash?.[1] ?? 0;
          if (item.shadow) {
            ops[o + 18] = parseColor(item.shadow.color);
            ops[o + 19] = item.shadow.blur;
            ops[o + 20] = item.shadow.dx ?? 0;
            ops[o + 21] = item.shadow.dy ?? 0;
          }
          if (item.texture !== undefined) ops[o + 22] = this.textures.ensure(item.texture);
        }
      }
    }
    const paths = new Float32Array(pathLen);
    let off = 0;
    for (const c of pathChunks) {
      paths.set(c, off);
      off += c.length;
    }
    this.items.flush();
    return { ops: r * REC === ops.length ? ops : ops.subarray(0, r * REC), paths, records: r };
  }
}

/** Every item kind the encoder accepts (for exhaustiveness in callers). */
export type EncodableItem = CanvasItem;
