/**
 * The selection bar ("Selection actions"): a floating bar of commands for
 * the selected items, placed above the selection (below it when there is
 * no room above) from core geometry and the camera. It hides while a drag,
 * a marquee or a crop is under way, and when any selected kind has no bar
 * (per `selectionChromeFor`). A viewer who cannot edit gets it only for a
 * video (to play it).
 *
 * One note, shape or text (selected, or being typed into), or a table cell
 * being typed into, gets the text bar, groups split by dividers:
 *
 *   [kind] | size, (text color), bold, italic, link | bullets, alignment |
 *   fill, (cell color), border, lock | open link, (delete), More actions
 *
 * (kind for shapes and texts only, text color for texts only, cell color
 * and heat maps for a table cell; while typing there is no lock, and the
 * format buttons of `FormatBar.tsx` act on the typed selection rather than
 * the whole text). Anything else gets:
 *
 *   [video] | [kind] | size, text color, alignment |
 *   fill, arrow start, border / line / ink, arrow end, crop, picture link,
 *   align items, lock | open link, (delete), More actions
 *
 * each control only when every selected item takes it (arrows aside).
 * Delete is on the bar for touch only; layer order, group, tidy up,
 * delete, copy and the rest are in More actions (the context menu).
 * Locked items in a mixed selection are left out (they cannot change);
 * an all-locked selection keeps its controls, which then refuse.
 *
 * Every edit runs through the commands in `services/actions.ts`, so the
 * bar, the keyboard and the context menu refuse and announce alike.
 */

import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignLeft, AlignCenter, AlignRight, AlignStartHorizontal, AlignStartVertical, ArrowUpRight, Check, CircleDot, Crop, Ellipsis, Link2, Lock, Minus, MoveLeft, MoveRight, Shapes, Trash2, Type } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  INK_COLOR_NAMES,
  NOTE_COLORS,
  SHAPE_KIND_LABELS,
  TEXT_SIZES,
  TEXT_SIZE_STYLES,
  alignmentUnits,
  arrowBoundsBox,
  arrowHeads,
  blockColorHex,
  capitalizeFirstLetter,
  elementBoundsWithTitle,
  isElementLocked,
  selectionChromeFor,
  showsTextPlaceholder,
  tableCellFill,
  tableFillPaint,
  themedInkColor,
  unionBounds,
  withoutLockedIds,
  withoutLockedIdsUnlessAll,
  type ArrowHeadKind,
  type BoardElement,
  type BoardInk,
  type Box,
  type ElementId,
  type ElementMeasures,
  type ElementsById,
  type FillColor,
  type ImageElement,
  type InkColor,
  type TableAxis,
  type TableElement,
  type TextAlign,
  type TextSize,
} from '@open-artifact/whiteboard-core';
import { surfaceRef } from '../canvas/BoardSurface.tsx';
import { openBoardLink, linkDisplayUrl } from '../elements/links.ts';
import { isRichTextItem, type RichTextItem } from '../elements/mark-across.ts';
import { boardToScreen } from '../lib/camera.ts';
import { barKeyTarget } from '../lib/toolbar-keys.ts';
import { TABLE_HEAT_LABELS, heatColorFor, heatRampGradient, takesRowHeat } from '../lib/table-heat.ts';
import { ALIGN_SHORTCUT_LETTERS, BASIC_SHAPE_KINDS, MORE_SHAPE_KINDS, isApplePlatform, type AlignEdge } from '../lib/tools.ts';
import { blockKindOf, isKindChangeable, type BlockKind } from '../selection/kind-change.ts';
import { useContextMenu } from '../selection/menu-store.ts';
import { useInteraction } from '../selection/store.ts';
import {
  alignSelectionTo,
  boardElements,
  canEditBoard,
  deleteSelection,
  ensureEditable,
  patchElements,
  selectedIds,
  setArrowDash,
  setArrowHead,
  setBlockKind,
  setFillColor,
  setImageLink,
  setShapeBorder,
  setShapeFill,
  setTableHeader,
  setTextAlign,
  setTextSize,
  toggleLockSelection,
} from '../services/actions.ts';
import { ALIGN_ACTION_LABELS, LOCKED_MESSAGE, TEXT_ALIGN_LABELS, announce, colorUpdatedMessage, refuse } from '../services/announce.ts';
import { pickTableHeatColor, setTableCellFill, toggleTableLineHeat } from '../services/table-edits.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { useTableHeat } from '../state/table-heat.ts';
import { useColorScheme } from '../state/theme.ts';
import { effectiveTool, useTool } from '../state/tool.ts';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromePopover, SwatchRow, TipGroup, ToolButton, type ChromeSide, type Swatch } from './chrome.tsx';
import { FormatBar } from './FormatBar.tsx';
import { useCoarsePointer } from './hooks.ts';
import { ShapeKindIcon } from './icons.tsx';
import { selectionLinks } from './selection-links.ts';
import { VideoControls } from './VideoControls.tsx';

/* ------------------------------------------------------------------------ */
/* Placement                                                                */
/* ------------------------------------------------------------------------ */

/**
 * The bar's height and its gap to the selection, screen pixels; a finger gets more air.
 * gap clears the side dot above the selection (12px out) and the turn zones' reach.
 */
export const SELECTION_BAR_METRICS = {
  fine: { height: 48, air: 24 },
  coarse: { height: 48, air: 32 },
} as const;

/** Room kept between the bar and the viewport edges, screen pixels. */
const EDGE_PX = 8;

/** Where the bar goes: its center x and top y in surface pixels, and whether it sits below the selection. */
export interface SelectionBarPlacement {
  x: number;
  y: number;
  below: boolean;
}

/** `value` held inside `[min, max]` (the middle when the range is empty). */
function clampBetween(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

/**
 * Places the bar for a selection whose box on screen is `selection`
 * (surface pixels): centered above it, or below it when the top is too
 * close to the viewport edge; kept inside the viewport, but never so far
 * that it leaves the selection's side (it follows the selection off screen).
 */
export function placeSelectionBar(
  selection: Box,
  bar: { width: number; height: number },
  view: { width: number; height: number },
  air: number,
): SelectionBarPlacement {
  const half = bar.width / 2;
  const left = selection.x;
  const right = selection.x + selection.w;
  let x = clampBetween(left + selection.w / 2, EDGE_PX + half, view.width - EDGE_PX - half);
  x = clampBetween(x, left - half, right + half);
  const aboveTop = selection.y - bar.height - air;
  const belowTop = selection.y + selection.h + air;
  const below = Math.round(aboveTop) < EDGE_PX;
  let y = clampBetween(below ? belowTop : aboveTop, EDGE_PX, view.height - bar.height - EDGE_PX);
  y = clampBetween(y, aboveTop, belowTop);
  return { x, y, below };
}

/**
 * ← / → and Home / End move focus along the bar's own buttons, past
 * disabled ones; not from a field in the bar or from a menu it opened.
 */
function moveAlongBar(event: ReactKeyboardEvent<HTMLDivElement>): void {
  const bar = event.currentTarget;
  const target = event.target;
  if (event.defaultPrevented || !(target instanceof HTMLButtonElement) || !bar.contains(target)) return;
  const controls = [...bar.querySelectorAll<HTMLButtonElement>('button')].filter((control) => control.getClientRects().length > 0);
  const enabled = controls.map((control) => !control.disabled && control.getAttribute('aria-disabled') !== 'true');
  const next = barKeyTarget({ key: event.key, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode }, controls.indexOf(target), enabled);
  if (next === undefined) return;
  event.preventDefault();
  controls[next]!.focus();
}

/** The selection's box on the board: every item's rotated bounds, a section's title band and an arrow's route. */
function selectionBounds(selected: readonly BoardElement[], byId: ElementsById, measures: ElementMeasures, zoom: number): Box | undefined {
  const boxes = selected.flatMap((element) => {
    const box = element.type === 'arrow' ? arrowBoundsBox(element, byId, measures) : elementBoundsWithTitle(element, measures, 'editor', zoom);
    return box ? [box] : [];
  });
  return unionBounds(boxes);
}


/* ------------------------------------------------------------------------ */
/* What the selection offers                                                */
/* ------------------------------------------------------------------------ */

/** The swatch name of "none" (no fill, no header row). */
const NONE = 'none';
/** A checkerboard: no paint. */
const NONE_PAINT: CSSProperties = {
  backgroundImage: 'conic-gradient(#d4d4d8 25%, #fff 0 50%, #d4d4d8 0 75%, #fff 0)',
  backgroundSize: '8px 8px',
};
/** A slashed circle: the "none" swatch in a row. */
const NONE_SWATCH = 'linear-gradient(135deg, transparent 45%, #e5484d 45%, #e5484d 55%, transparent 55%)';

/** The one value every entry shares, else `undefined`. */
function sameValue<T>(values: readonly T[]): T | undefined {
  const first = values[0];
  return values.every((value) => value === first) ? first : undefined;
}

/** The text size an item stores (a table shows its default); `undefined` when unset. */
function storedTextSize(element: BoardElement): TextSize | undefined {
  switch (element.type) {
    case 'note':
    case 'shape':
    case 'text':
      return element.size;
    case 'table':
      return element.size ?? 'body';
    default:
      return undefined;
  }
}

/** The text alignment an element shows (its default when unset). */
function textAlignOf(element: BoardElement): TextAlign | undefined {
  switch (element.type) {
    case 'shape':
      return element.textAlign ?? 'center';
    case 'note':
    case 'text':
    case 'table':
      return element.textAlign ?? 'left';
    default:
      return undefined;
  }
}

/** The fill color of a fillable item. */
function fillColorOf(element: BoardElement): string | undefined {
  return element.type === 'note' || element.type === 'container' || element.type === 'shape' || element.type === 'table' ? element.color : undefined;
}

/** The line color shared by drawings, arrows and outlined shapes (shapes without an outline do not count). */
function commonLineColor(elements: readonly BoardElement[]): string | undefined {
  let common: string | undefined;
  for (const element of elements) {
    const color = element.type === 'shape' ? element.stroke : element.type === 'stroke' || element.type === 'arrow' ? element.color : undefined;
    if (color === undefined) continue;
    if (common === undefined) common = color;
    else if (common !== color) return undefined;
  }
  return common;
}

/** What a line control works on: shape borders (arrows too), arrow lines, or drawing ink. */
type StrokeKind = 'border' | 'line' | 'ink';

/** A line control: its kind, the line style shared (`none`, `solid`, `dashed`) and the color. */
interface StrokeModel {
  kind: StrokeKind;
  style: 'none' | 'solid' | 'dashed' | undefined;
  color: string | undefined;
}

/** What the bar shows for a selection. */
interface BarModel {
  editable: boolean;
  /** Every item it works on is locked. */
  allLocked: boolean;
  /** The one note, shape or text selected: the text bar works on all of its text. */
  textItem: RichTextItem | undefined;
  kind: { current: BlockKind | undefined } | undefined;
  /** Text size and alignment (shown together). */
  text: { size: TextSize | undefined; chip: string; align: TextAlign | undefined } | undefined;
  textColor: { current: string | undefined } | undefined;
  fill:
    | {
        label: string;
        /** The color every item shows (none when mixed, hollow or without header). */
        current: string | undefined;
        none: { kind: 'shape' | 'table'; on: boolean } | undefined;
      }
    | undefined;
  stroke: StrokeModel | undefined;
  arrowEnds: { start: ArrowHeadKind | undefined; end: ArrowHeadKind | undefined } | undefined;
  /** The one selected picture or video (to crop and link). */
  image: ImageElement | undefined;
  /** The one selected video (for anyone, locked or not). */
  video: ElementId | undefined;
  /** The web links the selection offers (one opens from the bar). */
  links: readonly string[];
  alignable: boolean;
}

/** Works out the bar for the selected items. */
function barModel(all: readonly BoardElement[], elements: readonly BoardElement[], measures: ElementMeasures): BarModel {
  const editable = canEditBoard();
  // Locked items in a mixed selection are left out; an all-locked selection keeps them.
  const kept = withoutLockedIdsUnlessAll(elements, new Set(all.map((element) => element.id)));
  const selected = all.filter((element) => kept.has(element.id));
  const allLocked = selected.length > 0 && selected.every(isElementLocked);
  const nonArrows = selected.some((element) => element.type !== 'arrow') ? selected.filter((element) => element.type !== 'arrow') : selected;
  /** Every item (arrows aside) is one of `items`, or a text when texts may come along. */
  const styleableBy = (items: readonly BoardElement[], textsToo: boolean): boolean =>
    items.length > 0 && nonArrows.every((element) => (textsToo && element.type === 'text') || items.includes(element));

  const fillable = selected.filter((element) => element.type === 'note' || element.type === 'shape' || element.type === 'container' || element.type === 'table');
  const strokable = selected.filter((element) => element.type === 'stroke' || element.type === 'arrow' || element.type === 'shape');
  const shapes = selected.filter((element) => element.type === 'shape');
  const arrows = selected.filter((element) => element.type === 'arrow');
  const tables = selected.filter((element) => element.type === 'table');
  const texts = selected.filter((element) => element.type === 'text');
  const kindable = selected.filter(isKindChangeable);
  const richTargets = selected.filter((element) => isRichTextItem(element) || element.type === 'table');
  const only = selected.length === 1 ? selected[0] : undefined;

  const textShown = richTargets.length > 0 && nonArrows.every((element) => isRichTextItem(element) || element.type === 'table');
  const sizes = richTargets.map(storedTextSize);
  const size = sameValue(sizes);
  const chip =
    size !== undefined ? TEXT_SIZE_STYLES[size].label : sizes.every((value) => (value ?? 'small') === 'small') ? TEXT_SIZE_STYLES.small.label : 'Mixed';

  const hollow = shapes.some((shape) => shape.type === 'shape' && shape.hollow === true);
  const allHollow = shapes.length > 0 && shapes.length === fillable.length && shapes.every((shape) => shape.type === 'shape' && shape.hollow === true);
  const onlyTables = tables.length > 0 && tables.length === fillable.length;
  const sharedFill = sameValue(fillable.map(fillColorOf));
  const fillShown = sharedFill !== undefined && !hollow && tables.every((table) => table.type === 'table' && table.head);

  const strokeKind: StrokeKind =
    shapes.length > 0 && shapes.length + arrows.length === strokable.length ? 'border' : arrows.length > 0 && arrows.length === strokable.length ? 'line' : 'ink';
  const strokeless = shapes.filter((shape) => shape.type === 'shape' && shape.stroke === undefined).length;
  const dashed = arrows.filter((arrow) => arrow.type === 'arrow' && arrow.dash === true).length;
  const strokeStyle: StrokeModel['style'] =
    strokeKind === 'border'
      ? strokeless === shapes.length
        ? 'none'
        : strokeless === 0
          ? 'solid'
          : undefined
      : dashed === arrows.length
        ? 'dashed'
        : dashed === 0
          ? 'solid'
          : undefined;

  return {
    editable,
    allLocked,
    textItem: only !== undefined && isRichTextItem(only) ? only : undefined,
    kind: kindable.length > 0 && nonArrows.every(isKindChangeable) ? { current: sameValue(kindable.map(blockKindOf)) } : undefined,
    text: textShown ? { size, chip, align: sameValue(richTargets.map(textAlignOf)) } : undefined,
    textColor: styleableBy(texts, false) ? { current: sameValue(texts.map((text) => (text.type === 'text' ? text.color : undefined))) } : undefined,
    fill: styleableBy(fillable, true)
      ? {
          label: onlyTables ? 'Header color' : 'Fill color',
          current: fillShown ? sharedFill : undefined,
          none:
            shapes.length > 0 && shapes.length === fillable.length
              ? { kind: 'shape', on: allHollow }
              : onlyTables
                ? { kind: 'table', on: tables.every((table) => table.type === 'table' && !table.head) }
                : undefined,
        }
      : undefined,
    stroke: styleableBy(strokable, strokeKind !== 'ink')
      ? { kind: strokeKind, style: strokeStyle, color: strokeKind === 'border' ? commonLineColor(shapes) : commonLineColor(strokable) }
      : undefined,
    arrowEnds:
      arrows.length > 0 && arrows.length === selected.length
        ? {
            start: sameValue(arrows.map((arrow) => (arrow.type === 'arrow' ? arrowHeads(arrow)[0] : 'none'))),
            end: sameValue(arrows.map((arrow) => (arrow.type === 'arrow' ? arrowHeads(arrow)[1] : 'none'))),
          }
        : undefined,
    image: editable && only?.type === 'image' ? only : undefined,
    video: all.length === 1 && all[0]?.type === 'image' && all[0].video !== undefined ? all[0].id : undefined,
    links: selectionLinks(selected),
    alignable: all.length > 1 && alignmentUnits(elements, new Set(all.map((element) => element.id)), measures).length > 1,
  };
}

/* ------------------------------------------------------------------------ */
/* Line colors                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Colors the lines of the unlocked selection: shape borders, arrows and
 * drawings (`ink` leaves shapes without a border alone; `strokeless`
 * outlines only those, in ink).
 */
function paintLines(color: InkColor, kind: StrokeKind, strokeless = false): boolean {
  if (!ensureEditable()) return false;
  const ids = withoutLockedIds(boardElements(), selectedIds());
  if (ids.size === 0) return refuse(LOCKED_MESSAGE);
  const changed = patchElements(
    ids,
    (element) => {
      switch (element.type) {
        case 'shape':
          if (strokeless ? element.stroke !== undefined : kind === 'ink' && element.stroke === undefined) return element;
          return element.stroke === color ? element : { ...element, stroke: color };
        case 'arrow':
        case 'stroke':
          return strokeless || element.color === color ? element : { ...element, color };
        default:
          return element;
      }
    },
    { label: kind === 'border' ? 'Border' : 'Ink color' },
  );
  if (changed) announce(strokeless ? 'Border solid' : colorUpdatedMessage(kind === 'border' ? 'outline' : kind));
  return changed;
}

/** Colors the text of the unlocked free texts selected (arrows alongside keep their color). */
function paintTextColor(color: InkColor): boolean {
  if (!ensureEditable()) return false;
  const ids = withoutLockedIds(boardElements(), selectedIds());
  if (ids.size === 0) return refuse(LOCKED_MESSAGE);
  const changed = patchElements(ids, (element) => (element.type === 'text' && element.color !== color ? { ...element, color } : element), { label: 'Text color' });
  if (changed) announce(colorUpdatedMessage('text'));
  return changed;
}

/* ------------------------------------------------------------------------ */
/* Labels and icons                                                         */
/* ------------------------------------------------------------------------ */

/** A shortcut as this platform writes it. */
function shortcutLabel(key: string, options: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): string {
  if (isApplePlatform()) return (options.alt ? '⌥' : '') + (options.shift ? '⇧' : '') + (options.mod ? '⌘' : '') + key;
  return (options.mod ? 'Ctrl+' : '') + (options.alt ? 'Alt+' : '') + (options.shift ? 'Shift+' : '') + key;
}

/** A block kind's name. */
function blockKindLabel(kind: BlockKind): string {
  return kind === 'text' ? 'Text' : SHAPE_KIND_LABELS[kind];
}

/** Every kind a shape or text can turn into, in tray order. */
const BLOCK_KINDS: readonly BlockKind[] = [...BASIC_SHAPE_KINDS, ...MORE_SHAPE_KINDS, 'text'];

/** Arrow end styles as named in the menu. */
const ARROW_HEAD_LABELS: Readonly<Record<ArrowHeadKind, string>> = {
  none: 'None',
  arrow: 'Arrowhead',
  circle: 'Circle',
};

/** Line styles as named in the line popovers. */
const LINE_STYLE_LABELS = { none: 'None', solid: 'Solid', dashed: 'Dashed' } as const;

/** Alignment edges, in the align popover's two rows. */
const ALIGN_EDGE_ROWS: readonly (readonly { edge: AlignEdge; icon: ReactNode }[])[] = [
  [
    { edge: 'left', icon: <AlignStartVertical aria-hidden="true" /> },
    { edge: 'hcenter', icon: <AlignCenterVertical aria-hidden="true" /> },
    { edge: 'right', icon: <AlignEndVertical aria-hidden="true" /> },
  ],
  [
    { edge: 'top', icon: <AlignStartHorizontal aria-hidden="true" /> },
    { edge: 'vcenter', icon: <AlignCenterHorizontal aria-hidden="true" /> },
    { edge: 'bottom', icon: <AlignEndHorizontal aria-hidden="true" /> },
  ],
];

/** Text alignment icons. */
const TEXT_ALIGN_ICONS: Readonly<Record<TextAlign, ReactNode>> = {
  left: <AlignLeft aria-hidden="true" />,
  center: <AlignCenter aria-hidden="true" />,
  right: <AlignRight aria-hidden="true" />,
};

/** Three lines of growing weight: the border and line control. */
function LineWeightIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
      <path d="M3.2 3H12.8" strokeWidth={1} />
      <path d="M3.2 8H12.8" strokeWidth={1.5} />
      <path d="M3.2 13H12.8" strokeWidth={2} />
    </svg>
  );
}

/** A solid, dashed or missing line, drawn like a lucide icon. */
function LineStyleIcon({ style }: { style: 'none' | 'solid' | 'dashed' }) {
  if (style === 'none') return <Minus aria-hidden="true" className="opacity-40" />;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M4 12h16" strokeDasharray={style === 'dashed' ? '3 4' : undefined} />
    </svg>
  );
}

/** The icon of an arrow end style (`start` mirrors the arrowhead). */
function ArrowHeadIcon({ kind, end }: { kind: ArrowHeadKind | undefined; end: 'start' | 'end' }) {
  if (kind === 'arrow') return end === 'start' ? <MoveLeft aria-hidden="true" /> : <MoveRight aria-hidden="true" />;
  if (kind === 'circle') return <CircleDot aria-hidden="true" />;
  if (kind === 'none') return <Minus aria-hidden="true" />;
  return <Ellipsis aria-hidden="true" />;
}

/** The icon of a block kind. */
function BlockKindIcon({ kind }: { kind: BlockKind }) {
  return kind === 'text' ? <Type aria-hidden="true" /> : <ShapeKindIcon kind={kind} />;
}

/** The ink swatches: the palette (themed) and the board's own colors. */
function useInkSwatches(): Swatch[] {
  const scheme = useColorScheme();
  const added = useBoard((state) => state.board.content.inks);
  return useMemo(() => inkSwatches(added, scheme), [added, scheme]);
}

/** Palette inks then board inks, drawn for the scheme. */
function inkSwatches(added: readonly BoardInk[] | undefined, scheme: Parameters<typeof themedInkColor>[1]): Swatch[] {
  return [
    ...INK_COLOR_NAMES.map((name) => ({ name, value: themedInkColor(name, scheme), label: capitalizeFirstLetter(name) })),
    ...(added ?? []).map((entry) => ({ name: entry.color, value: themedInkColor(entry.color, scheme), label: entry.color.toUpperCase() })),
  ];
}

/** The fill swatches: the block palette. */
const FILL_SWATCHES: readonly Swatch[] = NOTE_COLORS.map((name) => ({ name, value: blockColorHex(name), label: capitalizeFirstLetter(name) }));

/* ------------------------------------------------------------------------ */
/* Controls                                                                 */
/* ------------------------------------------------------------------------ */

/** Props every popup control takes: the side its popup opens on (away from the selection). */
interface SideProps {
  side: ChromeSide;
}

/** A small rounded chip of a color: dashed when mixed, a checkerboard for none, an optional letter on it. */
function ColorChip({ paint, none = false, mark }: { paint: string | undefined; none?: boolean; mark?: ReactNode }) {
  const style: CSSProperties = paint !== undefined ? { background: paint } : none ? NONE_PAINT : {};
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-4 items-center justify-center rounded-[4px] border border-black/25 dark:border-white/30 ${paint === undefined && !none ? 'border-dashed' : ''}`}
      style={style}
    >
      {mark}
    </span>
  );
}

/** A color button: a chip that opens a row of swatches (an optional "None" first); a pick closes it. */
function ColorSwatchButton({
  label,
  side,
  swatches,
  current,
  paint,
  none,
  mark,
  onPick,
}: SideProps & {
  label: string;
  swatches: readonly Swatch[];
  /** The swatch name every item shares. */
  current: string | undefined;
  /** The chip's paint (`undefined`: mixed or none). */
  paint: string | undefined;
  none?: { on: boolean; onPick: () => void } | undefined;
  mark?: ReactNode;
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo<Swatch[]>(() => (none ? [{ name: NONE, value: NONE_SWATCH, label: 'None' }, ...swatches] : [...swatches]), [none, swatches]);
  return (
    <ChromePopover
      open={open}
      onOpenChange={setOpen}
      side={side}
      label={label}
      className="p-1.5"
      trigger={<ToolButton label={label} tipSide={side} icon={<ColorChip paint={paint} none={none?.on === true} mark={mark} />} />}
    >
      <SwatchRow
        label={label}
        swatches={rows}
        current={none?.on === true ? NONE : current}
        onPick={(name) => {
          setOpen(false);
          if (name === NONE) none?.onPick();
          else onPick(name);
        }}
        size={18}
        className="max-w-[min(420px,calc(100vw-48px))] overflow-x-auto"
      />
    </ChromePopover>
  );
}

/** The kind picker: every shape outline and Text. */
function KindPicker({ current, side }: SideProps & { current: BlockKind | undefined }) {
  const label = current === undefined ? 'Mixed' : blockKindLabel(current);
  return (
    <ChromePopover
      side={side}
      label="Kind"
      className="p-1.5"
      trigger={<ToolButton label={`Kind: ${label}`} tipSide={side} icon={current === undefined ? <Shapes aria-hidden="true" /> : <BlockKindIcon kind={current} />} />}
    >
      <div role="group" aria-label="Kind" className="grid grid-cols-7 gap-0.5 max-[420px]:grid-cols-5">
        {BLOCK_KINDS.map((kind) => (
          <ToolButton
            key={kind}
            size="lg"
            label={blockKindLabel(kind)}
            tipSide={side}
            icon={<BlockKindIcon kind={kind} />}
            pressed={current === kind}
            onClick={() => setBlockKind(kind, blockKindLabel(kind))}
          />
        ))}
      </div>
    </ChromePopover>
  );
}

/** The text size menu: its button shows the size by name; each choice is set in its own size. */
function TextSizeMenu({ current, chip, side }: SideProps & { current: TextSize | undefined; chip: string }) {
  return (
    <ChromeMenu
      side={side}
      align="center"
      tip={{ label: 'Text size', side }}
      trigger={
        <ChromeButton size="xl" aria-label={`Text size: ${chip}`} className="px-2">
          {chip}
        </ChromeButton>
      }
    >
      {TEXT_SIZES.map((size) => {
        const { px, weight, label } = TEXT_SIZE_STYLES[size];
        return (
          <ChromeMenuItem key={size} checked={current === size} onSelect={() => setTextSize(size)}>
            <span style={{ fontSize: Math.min(16, 12 * (px / 14) ** 0.15), fontWeight: weight }}>{label}</span>
          </ChromeMenuItem>
        );
      })}
    </ChromeMenu>
  );
}

/** The text alignment menu. */
function TextAlignMenu({ current, side }: SideProps & { current: TextAlign | undefined }) {
  const name = current === undefined ? 'Alignment: mixed' : `Alignment: ${TEXT_ALIGN_LABELS[current]}`;
  return (
    <ChromeMenu
      side={side}
      align="center"
      tip={{ label: name, side }}
      trigger={
        <ChromeButton square size="xl" aria-label={name}>
          {TEXT_ALIGN_ICONS[current ?? 'left']}
        </ChromeButton>
      }
    >
      {(['left', 'center', 'right'] as const).map((align) => (
        <ChromeMenuItem key={align} checked={current === align} icon={TEXT_ALIGN_ICONS[align]} onSelect={() => setTextAlign(align)}>
          {TEXT_ALIGN_LABELS[align]}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );
}

/** Text color (free text): a chip with a T on it. */
function TextColorButton({ current, side }: SideProps & { current: string | undefined }) {
  const scheme = useColorScheme();
  const swatches = useInkSwatches();
  const paint = current === undefined ? undefined : themedInkColor(current, scheme);
  return (
    <ColorSwatchButton
      label="Text color"
      side={side}
      swatches={swatches}
      current={current}
      paint={paint}
      mark={<span className={`text-[11px] font-semibold leading-none ${paint === undefined ? '' : 'text-white mix-blend-difference'}`}>T</span>}
      onPick={(name) => paintTextColor(name as InkColor)}
    />
  );
}

/** Fill color (Header color for tables), with None for shapes (hollow) and tables (no header row). */
function FillButton({ fill, side }: SideProps & { fill: NonNullable<BarModel['fill']> }) {
  const none = fill.none;
  return (
    <ColorSwatchButton
      label={fill.label}
      side={side}
      swatches={FILL_SWATCHES}
      current={fill.current}
      paint={fill.current === undefined ? undefined : blockColorHex(fill.current as FillColor)}
      none={none ? { on: none.on, onPick: () => (none.kind === 'shape' ? setShapeFill('none') : setTableHeader(null)) } : undefined}
      onPick={(name) => setFillColor(name as FillColor)}
    />
  );
}

/** A heat map toggle of the cell's column or row: a ramp of the color it has or would take, and a check while it is on. */
function HeatToggle({ table, axis, line }: { table: TableElement; axis: TableAxis; line: string }) {
  const scheme = useColorScheme();
  const lastPicked = useTableHeat((state) => state.lastPicked);
  const on = table.heat?.[axis]?.[line] !== undefined;
  return (
    <ChromeButton pressed={on} className="w-full justify-start gap-2 px-2" onClick={() => toggleTableLineHeat(table.id, axis, line)}>
      <span aria-hidden="true" className="h-3 w-6 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/10 dark:ring-white/15" style={{ background: heatRampGradient(heatColorFor(table, axis, line, lastPicked), scheme) }} />
      <span className="flex-1 text-left">{TABLE_HEAT_LABELS.toggle(axis)}</span>
      <span aria-hidden="true" className="flex size-4 items-center justify-center">{on ? <Check className="size-4" strokeWidth={2.25} /> : null}</span>
    </ChromeButton>
  );
}

/**
 * Cell color, for the table cell being typed into: its fill (None clears
 * it; the header row takes none), heat map toggles for its column and row
 * (no row heat map on the header row), and the color of a heat map that
 * covers it.
 */
function CellColorButton({ table, row, col, side }: SideProps & { table: TableElement; row: string; col: string }) {
  const [open, setOpen] = useState(false);
  const scheme = useColorScheme();
  const fill = tableCellFill(table, row, col);
  const rowHeat = takesRowHeat(table, row);
  const heatAxis: TableAxis | undefined = table.heat?.cols?.[col] !== undefined ? 'cols' : rowHeat && table.heat?.rows?.[row] !== undefined ? 'rows' : undefined;
  const heatLine = heatAxis === 'cols' ? col : row;
  const fillSwatches = useMemo<Swatch[]>(() => [{ name: NONE, value: NONE_SWATCH, label: 'None' }, ...FILL_SWATCHES], []);
  return (
    <ChromePopover
      open={open}
      onOpenChange={setOpen}
      side={side}
      label="Cell color"
      className="flex flex-col gap-1 p-1.5"
      trigger={<ToolButton label="Cell color" tipSide={side} icon={<ColorChip paint={fill === '' ? undefined : tableFillPaint(fill, scheme).fill} none={fill === ''} />} />}
    >
      {rowHeat ? (
        <SwatchRow
          label="Cell color"
          swatches={fillSwatches}
          current={fill === '' ? NONE : fill}
          onPick={(name) => {
            setOpen(false);
            setTableCellFill(table.id, [{ row, col }], name === NONE ? '' : (name as FillColor));
          }}
          size={18}
          className="max-w-[min(420px,calc(100vw-48px))] overflow-x-auto"
        />
      ) : null}
      <div role="group" aria-label="Heat map" className="flex flex-col">
        <HeatToggle table={table} axis="cols" line={col} />
        {rowHeat ? <HeatToggle table={table} axis="rows" line={row} /> : null}
      </div>
      {heatAxis !== undefined ? (
        <>
          <div className="px-1 pt-1 text-[12px] leading-4 text-chrome-muted">Heat map color</div>
          <SwatchRow
            label="Heat map color"
            swatches={FILL_SWATCHES}
            current={table.heat?.[heatAxis]?.[heatLine]}
            onPick={(name) => pickTableHeatColor(table.id, heatAxis, heatLine, name as FillColor)}
            size={18}
            className="max-w-[min(420px,calc(100vw-48px))] overflow-x-auto"
          />
        </>
      ) : null}
    </ChromePopover>
  );
}

/** Drawing ink, for a selection of drawings (with whatever else takes a line color). */
function InkButton({ stroke, side }: SideProps & { stroke: StrokeModel }) {
  const scheme = useColorScheme();
  const swatches = useInkSwatches();
  return (
    <ColorSwatchButton
      label="Ink color"
      side={side}
      swatches={swatches}
      current={stroke.color}
      paint={stroke.color === undefined ? undefined : themedInkColor(stroke.color, scheme)}
      onPick={(name) => paintLines(name as InkColor, 'ink')}
    />
  );
}

/** Border (shapes) or Line (arrows): the line style, then its color. */
function LineStylePopover({ stroke, side }: SideProps & { stroke: StrokeModel }) {
  const swatches = useInkSwatches();
  const border = stroke.kind === 'border';
  const name = border ? 'Border' : 'Line';
  const styles = border ? (['none', 'solid'] as const) : (['solid', 'dashed'] as const);
  const pickStyle = (style: 'none' | 'solid' | 'dashed'): void => {
    if (!border) setArrowDash(style === 'dashed');
    else if (style === 'none') setShapeBorder(null);
    else paintLines('ink', 'border', true);
  };
  return (
    <ChromePopover side={side} label={name} className="flex flex-col gap-1.5 p-1.5" trigger={<ToolButton label={name} tipSide={side} icon={<LineWeightIcon />} />}>
      <div role="radiogroup" aria-label={border ? 'Border style' : 'Line style'} className="flex items-center gap-0.5">
        {styles.map((style) => (
          <ChromeButton
            key={style}
            size="lg"
            role="radio"
            aria-checked={stroke.style === style}
            pressed={stroke.style === style}
            className="flex-1 gap-1.5 px-2"
            onClick={() => pickStyle(style)}
          >
            <LineStyleIcon style={style} />
            {LINE_STYLE_LABELS[style]}
          </ChromeButton>
        ))}
      </div>
      <SwatchRow
        label={border ? 'Border color' : 'Line color'}
        swatches={swatches}
        current={stroke.color}
        onPick={(color) => paintLines(color as InkColor, stroke.kind)}
        size={18}
        className="max-w-[min(420px,calc(100vw-48px))] overflow-x-auto"
      />
    </ChromePopover>
  );
}

/** One arrow end's style. */
function ArrowEndPicker({ end, current, side }: SideProps & { end: 'start' | 'end'; current: ArrowHeadKind | undefined }) {
  const label = `${end === 'start' ? 'Arrow start' : 'Arrow end'}: ${current === undefined ? 'mixed' : current === 'arrow' ? 'arrowhead' : current}`;
  return (
    <ChromeMenu
      side={side}
      align="center"
      tip={{ label, side }}
      trigger={
        <ChromeButton square size="xl" aria-label={label}>
          <ArrowHeadIcon kind={current} end={end} />
        </ChromeButton>
      }
    >
      {(['none', 'arrow', 'circle'] as const).map((kind) => (
        <ChromeMenuItem key={kind} checked={current === kind} icon={<ArrowHeadIcon kind={kind} end={end} />} onSelect={() => setArrowHead(end, kind)}>
          {ARROW_HEAD_LABELS[kind]}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );
}

/** A picture's web link: add, change or remove it. */
function PictureLinkButton({ image, side }: SideProps & { image: ImageElement }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <ChromePopover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(image.href ?? '');
      }}
      side={side}
      label="Picture link"
      className="p-2"
      trigger={
        <ToolButton
          label="Link"
          tip={image.href === undefined ? 'Link the picture' : `Edit the link to ${linkDisplayUrl(image.href)}`}
          tipSide={side}
          icon={<Link2 aria-hidden="true" />}
          pressed={image.href !== undefined}
        />
      }
    >
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          setImageLink(image.id, draft);
          setOpen(false);
        }}
      >
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Paste a web address"
          aria-label="Web address"
          className="h-8 w-60 max-w-[calc(100vw-200px)] rounded-[8px] bg-chrome-field px-2 text-[14px] text-chrome-fg outline-none ring-1 ring-inset ring-chrome-line placeholder:text-chrome-muted focus-visible:ring-2 focus-visible:ring-chrome-accent"
        />
        <ChromeButton type="submit" size="lg">
          Save
        </ChromeButton>
        {image.href !== undefined ? (
          <ChromeButton
            size="lg"
            onClick={() => {
              setImageLink(image.id, null);
              setOpen(false);
            }}
          >
            Remove
          </ChromeButton>
        ) : null}
      </form>
    </ChromePopover>
  );
}

/**
 * Align items (two or more): the six edges, in two rows. A refused trigger
 * stays focusable (`aria-disabled`), so closing the popover still hands
 * focus back to it and its tooltip can say why.
 */
function AlignItemsPopover({ side, refused }: SideProps & { refused: string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <ChromePopover
      open={open}
      onOpenChange={(next) => setOpen(next && refused === undefined)}
      side={side}
      label="Align items"
      className="p-1.5"
      trigger={
        <ToolButton
          label="Align items"
          tip={refused === undefined ? 'Align items' : `Align items. ${refused}`}
          tipSide={side}
          icon={<AlignStartVertical aria-hidden="true" />}
          aria-disabled={refused !== undefined || undefined}
          className="aria-disabled:opacity-40"
        />
      }
    >
      <div role="group" aria-label="Align items" className="flex items-center gap-3">
        {ALIGN_EDGE_ROWS.map((row) => (
          <span key={row[0]!.edge} className="flex items-center gap-1">
            {row.map(({ edge, icon }) => (
              <ToolButton
                key={edge}
                size="lg"
                label={ALIGN_ACTION_LABELS[edge].name}
                tipSide={side}
                shortcut={shortcutLabel(ALIGN_SHORTCUT_LETTERS[edge], { alt: true })}
                icon={icon}
                onClick={() => {
                  setOpen(false);
                  alignSelectionTo(edge);
                }}
              />
            ))}
          </span>
        ))}
      </div>
    </ChromePopover>
  );
}

/* ------------------------------------------------------------------------ */
/* The bar                                                                  */
/* ------------------------------------------------------------------------ */

/** Joins non-empty groups of controls with dividers. */
function withDividers(groups: readonly (readonly ReactNode[])[]): ReactNode[] {
  const out: ReactNode[] = [];
  groups
    .map((group) => group.filter((control) => control !== null && control !== false && control !== undefined))
    .filter((group) => group.length > 0)
    .forEach((group, index) => {
      if (index > 0) out.push(<ChromeDivider key={`divider-${index}`} />);
      out.push(...group);
    });
  return out;
}

/** The floating bar of commands for the selection (see the module comment). Mount it once, beside the surface. */
export function SelectionBar(): ReactNode {
  const ids = useSelection((state) => state.ids);
  const editing = useSelection((state) => state.editing);
  const cropping = useSelection((state) => state.cropping);
  const marquee = useSelection((state) => state.marquee);
  const transform = useInteraction((state) => state.transform);
  const tool = useTool((state) => effectiveTool(state));
  const byId = useBoard((state) => state.byId);
  const elements = useBoard((state) => state.board.content.elements);
  const measures = useMeasures((state) => state.measures);
  const camera = useCamera((state) => state.camera);
  const viewWidth = useCamera((state) => state.width);
  const viewHeight = useCamera((state) => state.height);
  const menuOpen = useContextMenu((state) => state.open && state.kind === 'items');
  const coarse = useCoarsePointer();

  const selected = useMemo(() => ids.flatMap((id) => byId.get(id) ?? []), [ids, byId]);
  const idle = selected.length > 0 && cropping === null && marquee === null && transform === null;
  // Typing into a text that showed only its placeholder starts without the bar.
  const bare = useMemo(() => {
    if (editing?.kind !== 'element' || editing.formatted === true) return false;
    const element = useBoard.getState().byId.get(editing.id);
    return element !== undefined && showsTextPlaceholder(element);
  }, [editing]);
  // While text is typed in place, the bar becomes the typing bar (format controls).
  const typing =
    idle &&
    !bare &&
    editing !== null &&
    editing.kind !== 'arrow-label' &&
    selected.length === 1 &&
    selected[0]!.id === editing.id &&
    selectionChromeFor(selected[0]!.type, 'typing', { tool }).bar;
  const wanted = typing || (idle && editing === null && selected.every((element) => selectionChromeFor(element.type, 'selected', { tool }).bar));
  const model = useMemo(() => (wanted ? barModel(selected, elements, measures) : undefined), [wanted, selected, elements, measures]);
  // A viewer who cannot edit gets the bar only to play a video.
  const visible = model !== undefined && (model.editable || model.video !== undefined);
  const bounds = useMemo(
    () => (visible ? selectionBounds(selected, byId, measures, camera.zoom) : undefined),
    [visible, selected, byId, measures, camera.zoom],
  );

  const barRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: SELECTION_BAR_METRICS.fine.height,
  });
  const shown = visible && bounds !== undefined;
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!shown || !bar) return;
    const measure = (): void => {
      const width = bar.offsetWidth;
      const height = bar.offsetHeight;
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [shown]);

  if (!shown || model === undefined || bounds === undefined) return null;

  const topLeft = boardToScreen(camera, { x: bounds.x, y: bounds.y });
  const onScreen: Box = { x: topLeft.x, y: topLeft.y, w: bounds.w * camera.zoom, h: bounds.h * camera.zoom };
  const metrics = coarse ? SELECTION_BAR_METRICS.coarse : SELECTION_BAR_METRICS.fine;
  const placement = placeSelectionBar(onScreen, size, { width: viewWidth, height: viewHeight }, metrics.air);
  const surface = surfaceRef.current?.getBoundingClientRect();
  const style: CSSProperties = {
    left: (surface?.left ?? 0) + placement.x,
    top: (surface?.top ?? 0) + placement.y,
    transform: 'translateX(-50%)',
    ...(size.width === 0 ? { visibility: 'hidden' } : {}),
  };
  const side: ChromeSide = placement.below ? 'bottom' : 'top';
  const cell = typing && editing?.kind === 'cell';
  /** Leaves the text being typed (it is kept) before a command that works on the item. */
  const leaveTyping = (): void => {
    if (typing) useSelection.getState().edit(null);
  };

  const videoControl = model.video !== undefined ? <VideoControls key="video" id={model.video} side={side} /> : null;
  const kindControl = model.kind && !cell ? <KindPicker key="kind" current={model.kind.current} side={side} /> : null;
  const sizeControl = model.text ? <TextSizeMenu key="size" current={model.text.size} chip={model.text.chip} side={side} /> : null;
  const textColorControl = model.textColor ? <TextColorButton key="text-color" current={model.textColor.current} side={side} /> : null;
  const alignControl = model.text ? <TextAlignMenu key="align" current={model.text.align} side={side} /> : null;
  const fillControl = model.fill ? <FillButton key="fill" fill={model.fill} side={side} /> : null;
  const cellTable = cell && editing?.kind === 'cell' && selected[0]?.type === 'table' ? selected[0] : undefined;
  const cellColorControl =
    cellTable !== undefined && editing?.kind === 'cell' ? <CellColorButton key="cell-color" table={cellTable} row={editing.row} col={editing.col} side={side} /> : null;
  const strokeControl = model.stroke ? (
    model.stroke.kind === 'ink' ? <InkButton key="stroke" stroke={model.stroke} side={side} /> : <LineStylePopover key="stroke" stroke={model.stroke} side={side} />
  ) : null;
  const lockControl = typing ? null : (
    <ToolButton
      key="lock"
      label="Lock"
      tip={model.allLocked ? 'Unlock' : 'Lock'}
      tipSide={side}
      shortcut={shortcutLabel('L', { mod: true, shift: true })}
      pressed={model.allLocked}
      icon={<Lock aria-hidden="true" />}
      onClick={() => toggleLockSelection()}
    />
  );
  const [link] = model.links;
  const actions = [
    model.links.length === 1 && link !== undefined ? (
      <ToolButton
        key="open-link"
        label="Open link"
        tip={`Open link: ${linkDisplayUrl(link)}`}
        tipSide={side}
        icon={<ArrowUpRight aria-hidden="true" />}
        onClick={() => {
          leaveTyping();
          openBoardLink(link);
        }}
      />
    ) : null,
    coarse && !model.allLocked ? (
      <ToolButton
        key="delete"
        label="Delete"
        tipSide={side}
        icon={<Trash2 aria-hidden="true" />}
        onClick={() => {
          leaveTyping();
          deleteSelection();
        }}
      />
    ) : null,
    <ToolButton
      key="more"
      label="More actions"
      tipSide={side}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      icon={<Ellipsis aria-hidden="true" />}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        leaveTyping();
        useContextMenu.getState().show({ at: { x: rect.left, y: rect.bottom + 6 }, kind: 'items' });
      }}
    />,
  ];

  let content: ReactNode;
  if (!model.editable) {
    content = videoControl;
  } else if (typing || model.textItem !== undefined) {
    // The text bar: the format controls work on the typed selection, or on all of the item's text.
    content = (
      <FormatBar side={side} cell={cell} {...(typing ? {} : { whole: model.textItem })}>
        {({ marks, bullets }) =>
          withDividers([[kindControl], [sizeControl, textColorControl, ...marks], [bullets, alignControl], [fillControl, cellColorControl, strokeControl, lockControl], actions])
        }
      </FormatBar>
    );
  } else {
    const imageControls = model.image
      ? [
          model.image.video === undefined ? (
            <ToolButton
              key="crop"
              label="Crop"
              tip={model.allLocked ? LOCKED_MESSAGE : 'Crop (or double-click the picture)'}
              tipSide={side}
              icon={<Crop aria-hidden="true" />}
              disabled={model.allLocked}
              onClick={() => useSelection.getState().setCropping(model.image!.id)}
            />
          ) : null,
          <PictureLinkButton key="picture-link" image={model.image} side={side} />,
        ]
      : [];
    content = withDividers([
      [videoControl],
      [kindControl],
      model.text ? [sizeControl, textColorControl, alignControl] : [],
      [
        fillControl,
        model.arrowEnds ? <ArrowEndPicker key="start" end="start" current={model.arrowEnds.start} side={side} /> : null,
        strokeControl,
        model.arrowEnds ? <ArrowEndPicker key="end" end="end" current={model.arrowEnds.end} side={side} /> : null,
        ...imageControls,
        model.alignable ? <AlignItemsPopover key="align-items" side={side} refused={model.allLocked ? LOCKED_MESSAGE : undefined} /> : null,
        lockControl,
      ],
      actions,
    ]);
  }

  return (
    <TipGroup>
      <Card
        ref={barRef}
        role="toolbar"
        aria-label="Selection actions"
        data-wb-bar="selection"
        data-wb-region="selection"
        {...(typing ? { 'data-wb-format-bar': '' } : {})}
        className="fixed z-[30] max-w-[calc(100vw-16px)] overflow-x-auto p-1.5"
        style={style}
        onKeyDown={moveAlongBar}
      >
        {content}
      </Card>
    </TipGroup>
  );
}
