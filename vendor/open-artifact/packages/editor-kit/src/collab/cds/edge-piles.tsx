/**
 * Edge piles: a thread whose pin is out of view (the page scrolled past it, the canvas panned it off, it is under the
 * toolbar) gets no pin. Instead a tab hangs at that edge of the window, "More comments" and how many; a click shows the
 * nearest one (controller.showThread: the runtime brings it into view and opens its card). A side whose edge has no room
 * for a tab keeps its pins (out of view, as before). 
 *
 * Left out: right-to-left layout (the reserve and the tab order flip), the lift for the comment sidebar's tab
 * and comment regions (`commentRegionsEnabled`: the layer has no regions).
 *
 * Pin stack: pins that would overlap in a row (two comments on the same spot) are laid out side by side, 6px over each
 * other, leftwards when the row would run past the window's right edge.
 */
import type { CSSProperties } from 'react';
import { cn, Icon } from './cds.tsx';

export type PileSide = 'above' | 'below' | 'left' | 'right';
type Side = PileSide | 'in';

/** A box in viewport px. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A tab's widest (above, below) or tallest (left, right). */
const PILE_MAX = 148;
/** A tab's thickness, and the room a tab at the bottom keeps over the toolbar. */
const PILE_GAP = 24;
/** The window needs this width for any tab. */
const MIN_WIDTH = 164;
/** …and this much height between its top inset and bottom for the top or bottom tab; more when both show. */
const MIN_HEIGHT = 64;
const MIN_HEIGHT_BOTH = 96;
/** …and this much for a side tab; more when the top or bottom tab comes near the window's corners. */
const SIDE_MIN_HEIGHT = 180;
const SIDE_MIN_HEIGHT_TIGHT = 228;
/** The most a toolbar at the bottom lifts the bottom tab. */
const FOOT_MAX = 120;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The part of the box below the top inset. */
function band(box: Box, top: number): { top: number; bottom: number } {
  return { top: Math.max(box.top, top, 0), bottom: box.top + box.height };
}

/** Which edge a point (viewport px) is past, if any. */
export function sideOf(box: Box, point: { x: number; y: number }, top: number): Side {
  const { top: t, bottom } = band(box, top);
  if (point.y < t) return 'above';
  if (point.y > bottom) return 'below';
  if (point.x < box.left) return 'left';
  if (point.x > box.left + box.width) return 'right';
  return 'in';
}

/** Where a side's tab goes (its anchor point and transform), or null when the window has no room for it. */
function place(
  box: Box,
  side: PileSide,
  minHeight: number,
  { top: inset, floor = 0, gutter = 0, reserveRight = 0 }: { top: number; floor?: number; gutter?: number; reserveRight?: number },
): CSSProperties | null {
  const { top, bottom } = band(box, Math.max(floor, inset));
  const reserve = side === 'above' ? reserveRight : 0;
  if (bottom - top < minHeight || box.width < MIN_WIDTH + reserve) return null;
  const middle = (top + bottom) / 2;
  if (side === 'left') return { left: box.left + gutter, top: middle, transform: 'translateY(-50%)' };
  if (side === 'right') return { left: box.left + box.width - gutter, top: middle, transform: 'translate(-100%, -50%)' };
  const half = PILE_MAX / 2 + 8;
  return {
    left: clamp(box.left + box.width / 2, box.left + half, box.left + box.width - half - reserve),
    top: side === 'above' ? top : bottom - gutter,
    transform: side === 'above' ? 'translateX(-50%)' : 'translate(-50%, -100%)',
  };
}

export interface PileInput {
  /** The threads that have pins: id and point (viewport px). */
  points: readonly { id: string; x: number; y: number }[];
  /** The thread whose card is open: it stays a pin wherever it is. */
  openId: string | null;
  box: Box;
  /** The bar over the page (header), px from the box's top: what is under it is out of view. */
  top: number;
  /** The page's toolbar at the top: the top tab hangs from its bottom. */
  floor: number;
  /** The page's toolbar at the bottom, px from the box's bottom: the bottom tab sits that far up, all rounded. */
  foot: number;
  /** Room the top tab keeps clear at the right (the open "All comments" panel). */
  reserveRight: number;
}

export interface Piles {
  /** Per side: the threads past that edge, nearest first, and where its tab goes (null: no room, they keep pins). */
  sides: Record<PileSide, { ids: string[]; style: CSSProperties | null }>;
  /** The bottom tab is lifted over a toolbar. */
  floating: boolean;
  /** Threads drawn as a tab, not a pin. */
  piled: ReadonlySet<string>;
}

export function edgePiles({ points, openId, box, top, floor, foot, reserveRight }: PileInput): Piles {
  const past: Record<PileSide, { id: string; x: number; y: number }[]> = { above: [], below: [], left: [], right: [] };
  const sideById = new Map<string, PileSide>();
  for (const point of points) {
    if (point.id === openId) continue;
    const side = sideOf(box, point, top);
    if (side === 'in') continue;
    past[side].push(point);
    sideById.set(point.id, side);
  }
  // Nearest the edge first: a click shows the first.
  past.above.sort((a, b) => b.y - a.y);
  past.below.sort((a, b) => a.y - b.y);
  past.left.sort((a, b) => b.x - a.x);
  past.right.sort((a, b) => a.x - b.x);

  const minHeight = past.above.length > 0 && past.below.length > 0 ? MIN_HEIGHT_BOTH : MIN_HEIGHT;
  const above = past.above.length ? place(box, 'above', minHeight, { top, floor, reserveRight }) : null;
  const visible = band(box, Math.max(floor, top));
  const lift = foot > 0 ? Math.min(foot, FOOT_MAX, Math.max(0, visible.bottom - visible.top - (past.above.length > 0 ? PILE_GAP : 0) - PILE_GAP)) : 0;
  const below = past.below.length ? place(box, 'below', minHeight, { top, gutter: lift }) : null;
  // The side tabs need more height when the top or bottom tab comes within a tab's thickness of the corners.
  const room = [above, below].flatMap(style =>
    style && typeof style.left === 'number' ? [style.left - PILE_MAX / 2 - box.left, box.left + box.width - (style.left + PILE_MAX / 2)] : [],
  );
  const near = room.length > 0 ? Math.min(...room) : null;
  const sideMin = near !== null && near < PILE_GAP + 8 ? SIDE_MIN_HEIGHT_TIGHT : SIDE_MIN_HEIGHT;
  const left = past.left.length ? place(box, 'left', sideMin, { top }) : null;
  const right = past.right.length ? place(box, 'right', sideMin, { top }) : null;

  const styles: Record<PileSide, CSSProperties | null> = { above, below, left, right };
  const piled = new Set<string>();
  for (const [id, side] of sideById) if (styles[side]) piled.add(id);
  const sides = Object.fromEntries((Object.keys(past) as PileSide[]).map(side => [side, { ids: past[side].map(p => p.id), style: styles[side] }])) as Piles['sides'];
  return { sides, floating: lift > 0, piled };
}

// ---------- the tabs ----------

const PILE_CLASS =
  'pointer-events-auto relative flex items-center gap-xs border bg-surface-popover text-secondary shadow-sm cursor-[var(--cds-cursor-interactive)] outline-none focus-visible:outline-hidden focus-visible:shadow-focus';

const SHAPE_CLASS: Record<PileSide | 'floating', string> = {
  above: 'h-6 ps-xs pe-sm',
  below: 'h-6 border-b-0 ps-xs pe-sm',
  left: 'w-6 flex-col py-sm',
  right: 'w-6 flex-col py-sm',
  floating: 'h-6 rounded-[10px] ps-xs pe-sm',
};
const SHAPE_STYLE: Record<PileSide | 'floating', CSSProperties> = {
  above: { maxWidth: PILE_MAX, borderTopWidth: 0, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  below: { maxWidth: PILE_MAX, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  left: { maxHeight: PILE_MAX, borderLeftWidth: 0, borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  right: { maxHeight: PILE_MAX, borderRightWidth: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  floating: { maxWidth: PILE_MAX },
};
/** The caret points at the edge. */
const CARET_TURN: Record<PileSide, string | undefined> = { above: 'rotate(180deg)', below: undefined, left: 'rotate(90deg)', right: 'rotate(-90deg)' };
const WHERE: Record<PileSide, string> = { above: 'above', below: 'below', left: 'to the left', right: 'to the right' };

function Pile({ side, ids, style, floating, onOpen }: { side: PileSide; ids: readonly string[]; style: CSSProperties; floating: boolean; onOpen: (id: string) => void }) {
  const count = ids.length;
  const vertical = side === 'left' || side === 'right';
  const shape = side === 'below' && floating ? 'floating' : side;
  const caret = (
    <span key="caret" aria-hidden className="flex" style={{ transform: CARET_TURN[side] }}>
      <Icon name="CaretDown" size="xs" className="opacity-60" />
    </span>
  );
  const label = (
    <span
      key="label"
      aria-hidden
      className="flex min-h-0 min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap text-caption leading-none"
      style={vertical ? { writingMode: 'vertical-rl', transform: side === 'left' ? 'rotate(180deg)' : undefined } : undefined}
    >
      More comments
      <span dir="ltr" className="text-muted tabular-nums">
        {count > 99 ? '99+' : count}
      </span>
    </span>
  );
  return (
    <div style={{ position: 'fixed', ...style, pointerEvents: 'none' }}>
      <button
        type="button"
        data-comment-edge-pile={side}
        data-comment-edge-pile-threads={ids.join(' ')}
        aria-label={`More comments: jump to ${count === 1 ? '1 comment' : `${count} comments`} ${WHERE[side]}`}
        className={cn(PILE_CLASS, SHAPE_CLASS[shape])}
        style={SHAPE_STYLE[shape]}
        onClick={() => ids[0] && onOpen(ids[0])}
      >
        {side === 'left' ? [label, caret] : [caret, label]}
      </button>
    </div>
  );
}

export function EdgePiles({ piles, onOpen }: { piles: Piles; onOpen: (id: string) => void }) {
  return (['above', 'below', 'left', 'right'] as const).map(side => {
    const { ids, style } = piles.sides[side];
    return style && ids.length > 0 ? <Pile key={side} side={side} ids={ids} style={style} floating={piles.floating} onOpen={onOpen} /> : null;
  });
}

// ---------- the pin stack ----------

export function stackPins(pins: readonly { id: string; x: number; y: number; w: number }[], right: number, size: number): Map<string, number> {
  const near = size * 0.75;
  const overlaps = (a: { w: number; y: number }, ax: number, b: { w: number; y: number }, bx: number) =>
    ax - bx < b.w - size + near && bx - ax < a.w - size + near && Math.abs(b.y - a.y) < near;
  const sorted = [...pins].sort((a, b) => a.x - b.x || a.y - b.y);
  const groups: (typeof sorted)[] = [];
  for (const pin of sorted) {
    const group = groups.find(g => g.some(other => overlaps(pin, pin.x, other, other.x)));
    if (group) group.push(pin);
    else groups.push([pin]);
  }
  const layout = (group: typeof sorted): number[] => {
    if (group.length < 2) return group.map(p => p.x);
    const start = group[0]!.x;
    if (start + group.reduce((sum, p) => sum + p.w - 6, 6) > right) {
      const xs: number[] = [];
      let edge = start + group[0]!.w;
      for (const p of group) {
        xs.push(edge - p.w);
        edge -= p.w - 6;
      }
      return xs;
    }
    let x = start;
    return group.map(p => {
      const at = x;
      x += p.w - 6;
      return at;
    });
  };
  let merged = true;
  while (merged && groups.length > 1) {
    merged = false;
    const xs = groups.map(layout);
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i]!.some((a, ai) => groups[j]!.some((b, bi) => overlaps(a, xs[i]![ai]!, b, xs[j]![bi]!)))) {
          groups[i] = [...groups[i]!, ...groups[j]!].sort((a, b) => a.x - b.x || a.y - b.y);
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  const shift = new Map<string, number>();
  for (const group of groups) {
    if (group.length < 2) continue;
    const xs = layout(group);
    group.forEach((p, i) => shift.set(p.id, xs[i]! - p.x));
  }
  return shift;
}
