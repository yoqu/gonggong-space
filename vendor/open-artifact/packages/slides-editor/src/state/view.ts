/**
 * The view store: what this tab shows and has selected. Nothing here is
 * saved to the artifact; a few preferences persist in localStorage.
 */

import { create } from 'zustand';
import type { NodePath, ShapeKind, StyleMap } from '@open-artifact/slides-core';

/** The editor's faces. */
export type ViewMode = 'edit' | 'grid' | 'canvas';

/** What a click-drag on the stage draws. */
export type Tool = 'select' | 'text' | ShapeKind | 'connector';

/** A text element being typed into. */
export interface TextEdit {
  slideId: string;
  path: NodePath;
  /** A table cell (row, column) when editing a table. */
  cell?: readonly [number, number];
}

/** Presenting state. */
export interface Presenting {
  /** Slide the show starts at. */
  start: string;
  /** Open the speaker window too. */
  speaker: boolean;
  /**
   * One slide on its own, from a link: every build shown, arrows page whole
   * slides, no control bar or full screen.
   */
  only?: boolean;
}

/** Zoom of the stage: a factor, or fit to the window. */
export type Zoom = number | 'fit';

interface ViewState {
  mode: ViewMode;
  /**
   * Canvas view: a slide is being edited in place. The stage shows it with
   * its neighbours in place of the rail, and "Back to canvas" returns.
   */
  canvasEdit: boolean;
  /** Slide on the stage. */
  current: string | null;
  /** Selected elements of the slide on stage, most recent last. */
  selection: NodePath[];
  /** Selected slides in the rail / grid, most recent last (the current slide alone when empty). */
  slideSelection: string[];
  /** Grid: selected section keys. */
  sectionSelection: string[];
  /** Grid: the section whose description is being typed (`-` the opening run). */
  editingSection: string | null;
  textEdit: TextEdit | null;
  /** The picture being cropped. */
  cropping: NodePath | null;
  zoom: Zoom;
  /** Fit factor last computed by the stage (for the zoom readout). */
  fitScale: number;
  tool: Tool;
  showRail: boolean;
  showProperties: boolean;
  showNotes: boolean;
  findOpen: boolean;
  presenting: Presenting | null;
  /** Counts shows started, so following the same link again starts afresh. */
  presentRun: number;
  /** Copied style (Copy style / Paste style). */
  styleClipboard: { style: StyleMap; kind: string } | null;
  /** Slide hovered in the rail / grid by a drag (insertion gap). */
  dropGap: number | null;

  setMode(mode: ViewMode): void;
  /** Canvas view: edits a slide in place (or returns to the canvas with null). */
  editOnCanvas(id: string | null): void;
  showSlide(id: string | null, options?: { keepSelection?: boolean }): void;
  select(paths: NodePath[]): void;
  selectSlides(ids: string[]): void;
  selectSections(keys: string[]): void;
  setEditingSection(key: string | null): void;
  startTextEdit(edit: TextEdit): void;
  endTextEdit(): void;
  setCropping(path: NodePath | null): void;
  setZoom(zoom: Zoom): void;
  setFitScale(scale: number): void;
  setTool(tool: Tool): void;
  toggle(panel: 'showRail' | 'showProperties' | 'showNotes' | 'findOpen', value?: boolean): void;
  present(presenting: Presenting | null): void;
  setStyleClipboard(value: ViewState['styleClipboard']): void;
  setDropGap(gap: number | null): void;
}

const PREFS_KEY = 'open-artifact-slides:view';

/** Panel preferences remembered across visits. */
function readPrefs(): Partial<Pick<ViewState, 'showRail' | 'showProperties' | 'showNotes'>> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Pick<ViewState, 'showRail' | 'showProperties' | 'showNotes'>>) : {};
  } catch {
    return {};
  }
}

function writePrefs(state: Pick<ViewState, 'showRail' | 'showProperties' | 'showNotes'>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ showRail: state.showRail, showProperties: state.showProperties, showNotes: state.showNotes }));
  } catch {
    // Storage unavailable: preferences last for this visit only.
  }
}

const prefs = typeof window === 'undefined' ? {} : readPrefs();

export const useView = create<ViewState>()((set, get) => ({
  mode: 'edit',
  canvasEdit: false,
  current: null,
  selection: [],
  slideSelection: [],
  sectionSelection: [],
  editingSection: null,
  textEdit: null,
  cropping: null,
  zoom: 'fit',
  fitScale: 0.5,
  tool: 'select',
  showRail: prefs.showRail ?? true,
  showProperties: prefs.showProperties ?? true,
  showNotes: prefs.showNotes ?? false,
  findOpen: false,
  presenting: null,
  presentRun: 0,
  styleClipboard: null,
  dropGap: null,

  setMode(mode) {
    set({ mode, canvasEdit: false, textEdit: null, cropping: null, tool: 'select', sectionSelection: mode === 'edit' ? [] : get().sectionSelection, editingSection: null });
  },
  editOnCanvas(id) {
    if (id === null) {
      set({ canvasEdit: false, selection: [], textEdit: null, cropping: null, tool: 'select' });
      return;
    }
    get().showSlide(id);
    set({ mode: 'canvas', canvasEdit: true, sectionSelection: [], editingSection: null });
  },
  showSlide(id, options = {}) {
    const state = get();
    if (state.current === id && options.keepSelection) return;
    set({
      current: id,
      selection: options.keepSelection && state.current === id ? state.selection : [],
      textEdit: null,
      cropping: null,
      slideSelection: id ? (state.slideSelection.includes(id) && state.slideSelection.length > 1 ? state.slideSelection : [id]) : [],
    });
  },
  select(paths) {
    set({ selection: paths, cropping: null });
  },
  selectSlides(ids) {
    set({ slideSelection: ids });
  },
  selectSections(keys) {
    set({ sectionSelection: keys });
  },
  setEditingSection(key) {
    set({ editingSection: key });
  },
  startTextEdit(edit) {
    set({ textEdit: edit, selection: [edit.path], cropping: null, tool: 'select' });
  },
  endTextEdit() {
    if (get().textEdit) set({ textEdit: null });
  },
  setCropping(path) {
    set({ cropping: path, textEdit: null });
  },
  setZoom(zoom) {
    set({ zoom: typeof zoom === 'number' ? Math.min(4, Math.max(0.1, zoom)) : zoom });
  },
  setFitScale(scale) {
    if (Math.abs(get().fitScale - scale) > 1e-4) set({ fitScale: scale });
  },
  setTool(tool) {
    set({ tool, textEdit: tool === 'select' ? get().textEdit : null });
  },
  toggle(panel, value) {
    set({ [panel]: value ?? !get()[panel] } as Partial<ViewState>);
    writePrefs(get());
  },
  present(presenting) {
    set({ presenting, presentRun: get().presentRun + (presenting ? 1 : 0), textEdit: null, cropping: null });
  },
  setStyleClipboard(value) {
    set({ styleClipboard: value });
  },
  setDropGap(gap) {
    if (get().dropGap !== gap) set({ dropGap: gap });
  },
}));

/** The stage scale in effect. */
export function stageScale(state: Pick<ViewState, 'zoom' | 'fitScale'>): number {
  return state.zoom === 'fit' ? state.fitScale : state.zoom;
}
