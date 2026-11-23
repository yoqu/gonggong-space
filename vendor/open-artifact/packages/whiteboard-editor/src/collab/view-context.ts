/**
 * The view context: what this viewer's page tells the agent about what they
 * see and do, published as `room.presence({viewContext})` and attached to
 * every request sent from the board. The host hands it to the agent with
 * the viewer's next message (see SKILL.md, "Requests from the board").
 *
 * This module builds it (pure, unit-tested); `publish-context.ts` keeps it
 * published.
 */

import {
  elementPlainText,
  followViewArea,
  normalizeCommentLabelText,
  type BoardElement,
  type Box,
  type Camera,
  type ElementMeasures,
} from '@open-artifact/whiteboard-core';
import type { TextEditTarget } from '../state/selection.ts';
import { findBoardIssues, type BoardIssue } from './board-issues.ts';

/** Most selected ids listed. */
export const MAX_CONTEXT_SELECTED = 20;

/** Most selected items labeled. */
export const MAX_CONTEXT_LABELS = 5;

/** Characters of an item's text in its label. */
export const CONTEXT_LABEL_CHARS = 40;

/** Most bytes of the view context as JSON (hosts refuse more than 32 KB). */
export const MAX_VIEW_CONTEXT_BYTES = 32_000;

/** How long the page waits for things to settle before publishing (ms). */
export const VIEW_CONTEXT_DEBOUNCE_MS = 400;

/** A selected item, as the agent reads it. */
export interface ViewContextItem {
  id: string;
  /** Element type (`note`, `shape`, …). */
  kind: string;
  /** Its text, cut short (empty for items without text). */
  label: string;
}

/** Where an open comment is attached (board units). */
export interface ViewContextPin {
  /** The thread, once it exists. */
  thread?: string;
  x: number;
  y: number;
  /** Set for a comment on an area. */
  w?: number;
  h?: number;
}

/** What the viewer is typing in. */
export interface ViewContextEditing {
  id: string;
  /** `text`: the item's own text; `label`: an arrow's label; `cell`: a table cell. */
  kind: 'text' | 'label' | 'cell';
  row?: string;
  col?: string;
}

/** The view context, as published. */
export interface BoardViewContext {
  /** The person this page belongs to. */
  viewer: { id: string; name: string };
  /** `comment` while clicks drop comments. */
  mode?: 'comment';
  /** The active tool, when not the select tool. */
  tool?: string;
  /** Selected ids, most recent last. */
  selected?: string[];
  /** Labels of up to five selected items (the most recent). */
  selection?: ViewContextItem[];
  /** The board area in sight, clear of chrome, and the zoom. */
  viewport: { x: number; y: number; w: number; h: number; zoom: number };
  pin?: ViewContextPin;
  editing?: ViewContextEditing;
  /** Items being dragged. */
  moving?: string[];
  /** The key for the agent's claim (`board/claim-<key>`). */
  claim: string;
  /** Up to five problems measured in what the viewer sees, worst first. */
  issues?: BoardIssue[];
  /** How many more problems there are. */
  issuesMore?: number;
  /** The viewer's screen may differ from what the agent reads (unsaved changes, offline). */
  dirty?: true;
}

/** Everything {@link buildViewContext} reads. */
export interface ViewContextInput {
  viewer: { id: string; name: string };
  elements: readonly BoardElement[];
  byId: ReadonlyMap<string, BoardElement>;
  measures?: ElementMeasures;
  selected: readonly string[];
  editing: TextEditTarget | null;
  camera: Camera;
  /** Viewport size and chrome insets, CSS pixels. */
  viewport: { w: number; h: number; top: number; bottom: number };
  tool: string;
  commentMode: boolean;
  pin?: ViewContextPin;
  moving: readonly string[];
  claim: string;
  dirty: boolean;
}

function round(value: number): number {
  return Math.round(value);
}

/** The label of one item for the agent. */
export function viewContextItem(element: BoardElement): ViewContextItem {
  return { id: element.id, kind: element.type, label: normalizeCommentLabelText(elementPlainText(element), CONTEXT_LABEL_CHARS) };
}

/** UTF-8 size of a value as JSON. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Shrinks a context until it fits {@link MAX_VIEW_CONTEXT_BYTES}: labels go
 * first, then most of the selected ids, then issues, then what is moving.
 */
export function fitViewContext(context: BoardViewContext, maxBytes = MAX_VIEW_CONTEXT_BYTES): BoardViewContext {
  if (jsonBytes(context) <= maxBytes) return context;
  const steps: Array<(next: BoardViewContext) => BoardViewContext> = [
    ({ selection: _selection, ...rest }) => rest,
    (next) => (next.selected ? { ...next, selected: next.selected.slice(-MAX_CONTEXT_LABELS) } : next),
    ({ issues: _issues, issuesMore: _more, ...rest }) => rest,
    ({ moving: _moving, ...rest }) => rest,
    ({ selected: _selected, editing: _editing, pin: _pin, ...rest }) => rest,
  ];
  let next = context;
  for (const step of steps) {
    next = step(next);
    if (jsonBytes(next) <= maxBytes) return next;
  }
  return next;
}

/** The board area clear of chrome, rounded. */
export function viewContextViewport(camera: Camera, viewport: ViewContextInput['viewport']): BoardViewContext['viewport'] {
  const area: Box = followViewArea(camera, viewport);
  return { x: round(area.x), y: round(area.y), w: round(area.w), h: round(area.h), zoom: Math.round(camera.zoom * 100) / 100 };
}

/** Builds the view context. */
export function buildViewContext(input: ViewContextInput): BoardViewContext {
  const viewport = viewContextViewport(input.camera, input.viewport);
  const selected = input.selected.filter((id) => input.byId.has(id));
  const labeled = selected
    .slice(-MAX_CONTEXT_LABELS)
    .map((id) => input.byId.get(id))
    .filter((element): element is BoardElement => element !== undefined)
    .map(viewContextItem);
  const editing = input.editing && input.byId.has(input.editing.id) ? input.editing : null;
  const held = new Set([...input.moving, ...(editing ? [editing.id] : [])]);
  const { issues, more } = findBoardIssues({ elements: input.elements, measures: input.measures, view: viewport, held });
  const context: BoardViewContext = {
    viewer: { id: input.viewer.id, name: input.viewer.name },
    ...(input.commentMode ? { mode: 'comment' as const } : {}),
    ...(input.tool !== 'select' ? { tool: input.tool } : {}),
    ...(selected.length > 0 ? { selected: selected.slice(-MAX_CONTEXT_SELECTED), selection: labeled } : {}),
    viewport,
    ...(input.pin ? { pin: input.pin } : {}),
    ...(editing
      ? {
          editing:
            editing.kind === 'cell'
              ? { id: editing.id, kind: 'cell' as const, row: editing.row, col: editing.col }
              : { id: editing.id, kind: editing.kind === 'arrow-label' ? ('label' as const) : ('text' as const) },
        }
      : {}),
    ...(input.moving.length > 0 ? { moving: input.moving.slice(0, MAX_CONTEXT_SELECTED) } : {}),
    claim: input.claim,
    ...(issues.length > 0 ? { issues } : {}),
    ...(more > 0 ? { issuesMore: more } : {}),
    ...(input.dirty ? { dirty: true as const } : {}),
  };
  return fitViewContext(context);
}
