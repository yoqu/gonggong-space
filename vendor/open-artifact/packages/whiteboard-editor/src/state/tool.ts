/**
 * The tool store: the active tool and the options new content gets (ink
 * color, shape kind, note color). Tools are per tab.
 */

import { create } from 'zustand';
import type { FillColor, InkColor, NoteColor, ShapeKind } from '@open-artifact/whiteboard-core';
import { NEW_NOTE_TILT_RANGE } from '@open-artifact/whiteboard-core';
import type { ToolName, ToolPick } from '../lib/tools.ts';

/** A random tilt for a new note, never exactly 0. */
export function randomNoteTilt(random: () => number = Math.random): number {
  return Math.round((random() * 2 - 1) * NEW_NOTE_TILT_RANGE * 10) / 10 || 0.5;
}

/** A sticker to place: a catalog key or the face art, or a bare emoji. */
export interface StickerChoice {
  art?: string;
  glyph?: string;
}

export interface ToolState {
  tool: ToolName;
  /** Kind the shape tool places. */
  shapeKind: ShapeKind;
  /** The Shapes button's last pick (shape kind, table or section). */
  shapesPick: ToolPick;
  /** The Draw button's last pick. */
  drawPick: 'pen' | 'arrow';
  /** Pen color: a named ink or a custom `#rrggbb`. */
  ink: InkColor;
  /** Color of new notes. */
  noteColor: NoteColor;
  /** Fill of new shapes. */
  shapeColor: FillColor;
  /** The tool stays active after placing one item (double-click a tool). */
  sticky: boolean;
  /** Space or middle button held: temporary hand. */
  handOverride: boolean;
  /** Comment mode: a click drops a comment pin. */
  commentMode: boolean;
  /** What the sticker tool places; unset until one is picked. */
  sticker: StickerChoice | undefined;
  /** The tilt of the next note (drawn ahead by the note tool's ghost). */
  noteTilt: number;
  /** Takes the next note's tilt and draws a new one. */
  takeNoteTilt(): number;
  pick(pick: ToolPick, options?: { sticky?: boolean }): void;
  setInk(ink: ToolState['ink']): void;
  setNoteColor(color: NoteColor): void;
  setShapeColor(color: FillColor): void;
  setHandOverride(on: boolean): void;
  setCommentMode(on: boolean): void;
  /** Arms the sticker tool (`undefined`: the picker is open, no sticker yet). */
  armSticker(sticker: StickerChoice | undefined): void;
  /** Back to select after placing something (unless the tool is sticky). */
  placed(): void;
}

export const useTool = create<ToolState>()((set, get) => ({
  tool: 'select',
  shapeKind: 'rounded',
  shapesPick: { tool: 'shape', kind: 'rounded' },
  drawPick: 'pen',
  ink: 'ink',
  noteColor: 'yellow',
  shapeColor: 'white',
  sticky: false,
  handOverride: false,
  commentMode: false,
  sticker: undefined,
  noteTilt: randomNoteTilt(),
  takeNoteTilt() {
    const tilt = get().noteTilt;
    set({ noteTilt: randomNoteTilt() });
    return tilt;
  },
  pick(pick, options) {
    const next: Partial<ToolState> = { tool: pick.tool, sticky: options?.sticky ?? false, commentMode: false };
    if (pick.tool === 'shape' && pick.kind) {
      next.shapeKind = pick.kind;
      next.shapesPick = pick;
    } else if (pick.tool === 'table' || pick.tool === 'container') next.shapesPick = pick;
    if (pick.tool === 'pen' || pick.tool === 'arrow') next.drawPick = pick.tool;
    set(next);
  },
  setInk(ink) {
    set({ ink });
  },
  setNoteColor(color) {
    set({ noteColor: color });
  },
  setShapeColor(color) {
    set({ shapeColor: color });
  },
  setHandOverride(on) {
    if (get().handOverride !== on) set({ handOverride: on });
  },
  setCommentMode(on) {
    set({ commentMode: on, ...(on ? { tool: 'select' as const } : {}) });
  },
  armSticker(sticker) {
    set({ tool: 'sticker', sticker, sticky: true, commentMode: false });
  },
  placed() {
    if (!get().sticky && get().tool !== 'pen') set({ tool: 'select' });
  },
}));

/** The tool a press acts with right now (the hand while Space is held). */
export function effectiveTool(state: Pick<ToolState, 'tool' | 'handOverride'> = useTool.getState()): ToolName {
  return state.handOverride ? 'hand' : state.tool;
}
