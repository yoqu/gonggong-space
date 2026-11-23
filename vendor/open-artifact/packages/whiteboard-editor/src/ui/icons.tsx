/**
 * Icons of the board chrome: lucide icons for tools and actions, and shape
 * outlines drawn from the same path generator the board renders shapes
 * with, so a tray icon always matches what it places.
 */

import {
  Frame,
  Hand,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Sticker,
  StickyNote,
  Table,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { SHAPE_KIND_LABELS, shapePathData, type ShapeKind } from '@open-artifact/whiteboard-core';
import type { ToolName, ToolPick } from '../lib/tools.ts';

/** Width × height each shape kind's icon is drawn at (others use 180 × 120). */
const SHAPE_ICON_ASPECTS: Partial<Record<ShapeKind, readonly [number, number]>> = {
  rounded: [150, 150],
  ellipse: [150, 150],
  diamond: [160, 160],
  database: [140, 150],
  queue: [180, 140],
  document: [125, 150],
  person: [140, 150],
};

/** The outline of a shape kind, as a stroke-only icon sized like a lucide icon. */
export function ShapeKindIcon({ kind, className }: { kind: ShapeKind; className?: string }) {
  const [width, height] = SHAPE_ICON_ASPECTS[kind] ?? [180, 120];
  return (
    <svg
      width="1.2em"
      height="1.2em"
      viewBox={[(width - 200) / 2, (height - 200) / 2, 200, 200].join(' ')}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      className={className ?? 'shrink-0'}
      aria-hidden="true"
    >
      <path d={shapePathData(kind, width, height)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Lucide icon of every tool except `shape` (whose icon is its kind). */
export const TOOL_ICONS: Readonly<Record<Exclude<ToolName, 'shape'>, LucideIcon>> = {
  select: MousePointer2,
  hand: Hand,
  text: Type,
  note: StickyNote,
  pen: PenLine,
  arrow: MoveUpRight,
  sticker: Sticker,
  container: Frame,
  table: Table,
};

/** The icon of a tool pick. */
export function ToolPickIcon({ pick }: { pick: ToolPick }) {
  if (pick.tool === 'shape') return <ShapeKindIcon kind={pick.kind ?? 'rounded'} />;
  const Icon = TOOL_ICONS[pick.tool];
  return <Icon aria-hidden="true" />;
}

/** Display name of a tool pick. */
export function toolPickLabel(pick: ToolPick): string {
  switch (pick.tool) {
    case 'shape':
      return SHAPE_KIND_LABELS[pick.kind ?? 'rounded'];
    case 'container':
      return 'Section';
    case 'note':
      return 'Note';
    default:
      return pick.tool.charAt(0).toUpperCase() + pick.tool.slice(1);
  }
}
