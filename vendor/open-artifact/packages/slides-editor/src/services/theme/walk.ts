/**
 * The style walker of the Theme panel: visits every literal colour a slide
 * paints with — the slide and box grounds, fills, text and run colours,
 * lines (borders, connectors, decorations) and the fills and strokes of
 * inline SVG — with the ground it sits on, and rebuilds the slide with the
 * colours the visitor returns. Shadows, pictures and embedded pages are left
 * alone. Models are immutable: an unchanged slide (or node) is returned as is.
 */

import { NAMED_COLORS, type Run, type Slide, type SlideNode, type StyleMap, type TableRow } from '@open-artifact/slides-core';
import { hexOf } from './color.ts';

/** What a colour paints: a slide ground, an area, text, or a line. */
export type ColorProp = 'ground' | 'fill' | 'text' | 'line';

/** One colour a slide paints with. */
export interface ColorUse {
  prop: ColorProp;
  /** `#rrggbb` of the colour. */
  value: string;
  /** `#rrggbb` of the ground it sits on. */
  on: string;
}

/** Returns the colour to write instead (any subset spelling), or undefined to keep it. */
export type ColorVisitor = (use: ColorUse, raw: string) => string | undefined;

/** The ground of a slide with no background. */
export const DEFAULT_GROUND = '#ffffff';

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)|\b[a-zA-Z]+\b/g;

/**
 * Rewrites the colour literals of one CSS value (outside `url()`): `visit`
 * gets each colour's `#rrggbb` and its spelling.
 */
export function mapValueColors(value: string, visit: (hex: string, raw: string) => string | undefined): string {
  const parts = value.split(/(url\([^)]*\))/i);
  let changed = false;
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(COLOR_TOKEN, (token) => {
      if (/^[a-z]+$/i.test(token) && !Object.hasOwn(NAMED_COLORS, token.toLowerCase())) return token;
      const hex = hexOf(token);
      if (!hex) return token;
      const next = visit(hex, token);
      if (next === undefined || next === token) return token;
      changed = true;
      return next;
    });
  });
  return changed ? out.join('') : value;
}

/** The first colour of a value (a gradient's first stop), as `#rrggbb`. */
export function firstColor(value: string | undefined): string | null {
  if (!value) return null;
  let found: string | null = null;
  mapValueColors(value, (hex) => {
    found ??= hex;
    return undefined;
  });
  return found;
}

/** Properties whose colours are lines. */
const LINE_PROPS = ['border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'text-decoration', '-webkit-text-stroke'] as const;

/** SVG attributes and declarations holding a paint. */
const SVG_PAINT = /((?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*(?:=\s*["']?|:\s*))(#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)|[a-zA-Z]+)/g;

/** The colours of inline SVG markup. */
function mapSvg(markup: string, on: string, visit: ColorVisitor): string {
  let changed = false;
  const out = markup.replace(SVG_PAINT, (whole, lead: string, token: string) => {
    if (/^[a-z]+$/i.test(token) && !Object.hasOwn(NAMED_COLORS, token.toLowerCase())) return whole;
    const hex = hexOf(token);
    if (!hex) return whole;
    const next = visit({ prop: 'fill', value: hex, on }, token);
    if (next === undefined || next === token) return whole;
    changed = true;
    return lead + next;
  });
  return changed ? out : markup;
}

interface Walk {
  visit: ColorVisitor;
}

/** The colours of a style map; returns the new map (same object when unchanged) and the ground it sets for what it holds. */
function mapStyle(style: StyleMap, on: string, ground: 'ground' | 'fill', ctx: Walk): { style: StyleMap; ground: string } {
  let next: StyleMap = style;
  const set = (prop: keyof StyleMap, value: string): void => {
    if (value === style[prop]) return;
    if (next === style) next = { ...style };
    next[prop] = value;
  };
  let inner = on;
  const bg = style.background;
  if (bg) {
    const clipText = style['background-clip'] === 'text';
    const first = firstColor(bg);
    set('background', mapValueColors(bg, (hex, raw) => ctx.visit({ prop: clipText ? 'text' : ground, value: hex, on }, raw)));
    // A mostly opaque ground is what the element's contents sit on.
    if (!clipText && first && /^(#|rgb|hsl|[a-z])/i.test(bg.trim())) inner = first;
  }
  if (style.color) set('color', mapValueColors(style.color, (hex, raw) => ctx.visit({ prop: 'text', value: hex, on: inner }, raw)));
  for (const prop of LINE_PROPS) {
    const value = style[prop];
    if (value) set(prop, mapValueColors(value, (hex, raw) => ctx.visit({ prop: 'line', value: hex, on: inner }, raw)));
  }
  return { style: next, ground: inner };
}

/** Run colours. */
function mapRuns(runs: Run[], on: string, ctx: Walk): Run[] {
  let out: Run[] = runs;
  runs.forEach((run, i) => {
    const color = run.marks?.color;
    if (!color) return;
    const next = mapValueColors(color, (hex, raw) => ctx.visit({ prop: 'text', value: hex, on }, raw));
    if (next === color) return;
    if (out === runs) out = [...runs];
    out[i] = { ...run, marks: { ...run.marks, color: next } };
  });
  return out;
}

function mapRows(rows: TableRow[], on: string, ctx: Walk): TableRow[] {
  let out = rows;
  rows.forEach((row, r) => {
    const rowStyle = mapStyle(row.style, on, 'fill', ctx);
    let cells = row.cells;
    row.cells.forEach((cell, c) => {
      const cellStyle = mapStyle(cell.style, rowStyle.ground, 'fill', ctx);
      const runs = mapRuns(cell.runs, cellStyle.ground, ctx);
      if (cellStyle.style === cell.style && runs === cell.runs) return;
      if (cells === row.cells) cells = [...row.cells];
      cells[c] = { ...cell, style: cellStyle.style, runs };
    });
    if (rowStyle.style === row.style && cells === row.cells) return;
    if (out === rows) out = [...rows];
    out[r] = { ...row, style: rowStyle.style, cells };
  });
  return out;
}

function mapNode(node: SlideNode, on: string, ctx: Walk): SlideNode {
  const { style, ground } = node.kind === 'connector' ? mapConnectorStyle(node.style, on, ctx) : mapStyle(node.style, on, 'fill', ctx);
  let next: SlideNode = style === node.style ? node : ({ ...node, style } as SlideNode);
  const patch = (changes: Partial<SlideNode>): void => {
    next = { ...next, ...changes } as SlideNode;
  };
  switch (node.kind) {
    case 'text': {
      const runs = mapRuns(node.runs, ground, ctx);
      if (runs !== node.runs) patch({ runs } as Partial<SlideNode>);
      break;
    }
    case 'list': {
      let items = node.items;
      node.items.forEach((item, i) => {
        const runs = mapRuns(item.runs, ground, ctx);
        if (runs === item.runs) return;
        if (items === node.items) items = [...node.items];
        items[i] = { ...item, runs };
      });
      if (items !== node.items) patch({ items } as Partial<SlideNode>);
      break;
    }
    case 'textbox': {
      let blocks = node.blocks;
      node.blocks.forEach((block, i) => {
        const mapped = mapNode(block, ground, ctx);
        if (mapped === block) return;
        if (blocks === node.blocks) blocks = [...node.blocks];
        blocks[i] = mapped as typeof block;
      });
      if (blocks !== node.blocks) patch({ blocks } as Partial<SlideNode>);
      break;
    }
    case 'box': {
      let children = node.children;
      node.children.forEach((child, i) => {
        const mapped = mapNode(child, ground, ctx);
        if (mapped === child) return;
        if (children === node.children) children = [...node.children];
        children[i] = mapped;
      });
      if (children !== node.children) patch({ children } as Partial<SlideNode>);
      break;
    }
    case 'table': {
      const rows = mapRows(node.rows, ground, ctx);
      if (rows !== node.rows) patch({ rows } as Partial<SlideNode>);
      break;
    }
    case 'svg': {
      const markup = mapSvg(node.markup, ground, ctx.visit);
      if (markup !== node.markup) patch({ markup } as Partial<SlideNode>);
      break;
    }
    default:
      break;
  }
  return next;
}

/** A connector's `color` is its line. */
function mapConnectorStyle(style: StyleMap, on: string, ctx: Walk): { style: StyleMap; ground: string } {
  const color = style.color;
  const rest = mapStyle({ ...style, color: undefined }, on, 'fill', ctx);
  const nextColor = color ? mapValueColors(color, (hex, raw) => ctx.visit({ prop: 'line', value: hex, on }, raw)) : undefined;
  const changed = rest.style.background !== style.background || nextColor !== color || LINE_PROPS.some((p) => rest.style[p] !== style[p]);
  if (!changed) return { style, ground: rest.ground };
  const out: StyleMap = { ...rest.style };
  if (nextColor !== undefined) out.color = nextColor;
  else delete out.color;
  return { style: out, ground: rest.ground };
}

/**
 * Visits every colour of a slide and rebuilds it with the colours `visit`
 * returns. Returns the slide itself when nothing changed.
 */
export function mapSlideColors(slide: Slide, visit: ColorVisitor): Slide {
  const ctx: Walk = { visit };
  const { style, ground } = mapStyle(slide.style, DEFAULT_GROUND, 'ground', ctx);
  let children = slide.children;
  slide.children.forEach((child, i) => {
    const mapped = mapNode(child, ground, ctx);
    if (mapped === child) return;
    if (children === slide.children) children = [...slide.children];
    children[i] = mapped;
  });
  if (style === slide.style && children === slide.children) return slide;
  return { ...slide, style, children };
}

/** Every colour use of a slide (in paint order). */
export function slideColorUses(slide: Slide): ColorUse[] {
  const uses: ColorUse[] = [];
  mapSlideColors(slide, (use) => {
    uses.push(use);
    return undefined;
  });
  return uses;
}
