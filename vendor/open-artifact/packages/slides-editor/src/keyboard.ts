/**
 * Keyboard shortcuts of the editor (presenting has its own, in the
 * presenter). Shortcuts never fire while typing in a field or editing text,
 * except the few that make sense there (undo/redo stay native in text).
 *
 * | Keys            | Action                                        |
 * |-----------------|-----------------------------------------------|
 * | ⌘Z / ⇧⌘Z, ⌘Y    | Undo / redo                                   |
 * | ⌘M              | New slide (layout picker)                     |
 * | ⌘D              | Duplicate (elements or slides)                |
 * | ⌫ / Delete      | Delete (elements or slides)                   |
 * | ⌘A              | Select all                                    |
 * | ⌘G / ⇧⌘G        | Group / ungroup (find next / previous when the find bar is open) |
 * | ] / [           | Bring to front / send to back                 |
 * | ⌥⌘C / ⌥⌘V       | Copy / paste style                            |
 * | ⌥A H D / ⌥W V S | Align left, centers, right / top, middles, bottom |
 * | K               | Scale…                                        |
 * | T R ⇧R O D L ⇧L | Text, rectangle, rounded, ellipse, diamond, line, connector tools |
 * | Arrows          | Move 8px (Shift: 1px); no selection: previous / next slide |
 * | Enter / ⇧Enter  | Into a group or text / back out               |
 * | Tab / ⇧Tab      | Next / previous element                       |
 * | Esc             | Cancel tool, end editing, clear selection     |
 * | ⌘F, ⌘G, F3      | Find, next match                              |
 * | ⌥⌘L             | Copy the slide's link                         |
 * | ⌘Enter / ⇧⌘Enter| Present from this slide / from the start     |
 * | C               | Comment mode                                  |
 * | F6              | Focus the formatting toolbar                  |
 * | ←↑→↓ / + / -    | While cropping: move / zoom the picture        |
 * | ⌘= ⌘- ⌘0        | Zoom in / out / fit                           |
 * | ⌘\              | Show / hide the properties panel              |
 * | PgUp / PgDn     | Previous / next slide                         |
 * | ?               | Keyboard shortcuts                            |
 */

import { useDeck } from './state/deck.ts';
import { useUi } from './state/ui.ts';
import { stageScale, useView } from './state/view.ts';
import { clipboardRegion } from './services/clipboard.ts';
import {
  alignEdgeForKey,
  alignSelection,
  canChange,
  copySlideLink,
  copyStyle,
  cycleSelection,
  deleteSelection,
  deleteSlides,
  duplicateSelection,
  duplicateSlides,
  enterSelection,
  exitSelection,
  groupSelection,
  nudgeSelection,
  pasteStyle,
  redo,
  reorderSelection,
  selectAll,
  stepSlide,
  targetSlides,
  undo,
  ungroupSelection,
} from './services/commands.ts';
import { useAgent } from './services/agent.ts';
import { maybeSession } from './services/session.ts';
import { useComments } from './services/comments.ts';
import { useFind } from './services/find.ts';
import { playableSlides } from './services/present.ts';
import { nudgeCrop } from './components/stage/gestures.ts';
import { undoesScrub } from './lib/number-scrub.ts';
import { isCopySlideLinkKey } from './lib/slide-link.ts';
import { isComposingKey } from '@open-artifact/ui';

/**
 * True when the key event comes from a field that takes typing, or from a
 * dialog, menu or popup list that handles its own keys. The editor's own slide
 * lists (the rail, grid and canvas: multi-select listboxes) keep the shortcuts.
 */
function typing(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    Boolean(el.closest('[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"]:not([aria-multiselectable])'))
  );
}

/** True for a plain Enter or Space on a focused button or link: the control handles it. */
function pressesControl(event: KeyboardEvent): boolean {
  if ((event.key !== 'Enter' && event.key !== ' ') || event.metaKey || event.ctrlKey || event.altKey) return false;
  const el = event.target as HTMLElement | null;
  return Boolean(el?.closest('button,a[href],[role="button"]'));
}

/** Zoom steps of ⌘= / ⌘-. */
const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Zooms the stage one step in (1) or out (-1). */
export function zoomStep(direction: 1 | -1): void {
  const view = useView.getState();
  const current = stageScale(view);
  const next = direction > 0 ? ZOOMS.find((z) => z > current + 0.001) : [...ZOOMS].reverse().find((z) => z < current - 0.001);
  if (next) view.setZoom(next);
}

/** Columns of the grid view on screen (it publishes them on its scroller), else 1. */
function gridColumns(): number {
  const value = Number(document.querySelector<HTMLElement>('[data-open-artifact-grid-columns]')?.dataset.openArtifactGridColumns);
  return value > 0 ? value : 1;
}

/** Starts presenting from a slide (default: the current one). */
export function present(from: 'current' | 'start', speaker = false): void {
  const slides = playableSlides();
  if (slides.length === 0) return;
  const view = useView.getState();
  const start = from === 'start' ? slides[0]! : view.current && slides.includes(view.current) ? view.current : (slides.find((id) => id === view.current) ?? slides[0]!);
  view.present({ start, speaker });
}

/** Installs the editor's shortcuts. Returns the uninstaller. */
export function installKeyboard(): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const view = useView.getState();
    if (document.querySelector('[aria-modal="true"]') || view.presenting || useDeck.getState().status !== 'ready') return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const lower = key.toLowerCase();
    const findOpen = view.findOpen;

    // Find works everywhere, even while typing.
    if (mod && !event.altKey && lower === 'f') {
      event.preventDefault();
      view.toggle('findOpen', true);
      // Already open: the bar takes focus again.
      window.dispatchEvent(new Event('open-artifact-slides:focus-find'));
      return;
    }
    if ((findOpen && mod && lower === 'g') || key === 'F3') {
      event.preventDefault();
      if (!findOpen) view.toggle('findOpen', true);
      useFind.getState().step(event.shiftKey ? -1 : 1);
      return;
    }
    // ⌘\ shows or hides the properties panel, even while typing.
    if (mod && !event.altKey && key === '\\') {
      event.preventDefault();
      if (!useDeck.getState().readOnly && (view.mode === 'edit' || view.canvasEdit)) view.toggle('showProperties');
      return;
    }
    if ((typing(event) && (isComposingKey(event) || !undoesScrub(event))) || pressesControl(event)) return;
    const editing = canChange();
    // The one-slide stage is up (edit mode, or a slide edited on the canvas).
    const onStage = view.mode === 'edit' || view.canvasEdit;
    const slidesRegion = clipboardRegion() === 'slides' || !onStage;
    const hasSelection = view.selection.length > 0;

    // ⌘-shortcuts.
    if (mod) {
      if (lower === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (lower === 'y' && !event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (lower === 'm' && editing) {
        event.preventDefault();
        useUi.getState().open('newSlide');
        return;
      }
      if (lower === 'd' && editing) {
        event.preventDefault();
        if (slidesRegion || !hasSelection) duplicateSlides(targetSlides());
        else duplicateSelection();
        return;
      }
      if (lower === 'a' && !slidesRegion) {
        event.preventDefault();
        selectAll();
        return;
      }
      if (lower === 'a' && slidesRegion) {
        event.preventDefault();
        useView.getState().selectSlides(playableSlides().length ? targetSlidesAll() : []);
        return;
      }
      if (lower === 'g' && editing) {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (event.altKey && (event.code === 'KeyC' || lower === 'c')) {
        event.preventDefault();
        copyStyle();
        return;
      }
      if (event.altKey && (event.code === 'KeyV' || lower === 'v') && editing) {
        event.preventDefault();
        pasteStyle();
        return;
      }
      if (isCopySlideLinkKey(event)) {
        event.preventDefault();
        void copySlideLink();
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        present(event.shiftKey ? 'start' : 'current');
        return;
      }
      if (key === '=' || key === '+') {
        event.preventDefault();
        zoomStep(1);
        return;
      }
      if (key === '-') {
        event.preventDefault();
        zoomStep(-1);
        return;
      }
      if (key === '0') {
        event.preventDefault();
        view.setZoom('fit');
        return;
      }
      return;
    }

    // Cropping a picture: arrows move it, + / - zoom, Enter or Escape finish.
    if (view.cropping && view.current && onStage) {
      const crop = view.cropping;
      if (key === 'Enter' || key === 'Escape') {
        event.preventDefault();
        view.setCropping(null);
        return;
      }
      const step = event.shiftKey ? 1 : 5;
      const delta: Record<string, [number, number, number]> = {
        ArrowLeft: [-step, 0, 1],
        ArrowRight: [step, 0, 1],
        ArrowUp: [0, -step, 1],
        ArrowDown: [0, step, 1],
        '+': [0, 0, 1.1],
        '=': [0, 0, 1.1],
        '-': [0, 0, 1 / 1.1],
        _: [0, 0, 1 / 1.1],
      };
      const move = delta[key];
      if (move) {
        event.preventDefault();
        if (editing) nudgeCrop(view.current, crop, move[0], move[1], move[2]);
        return;
      }
    }

    switch (key) {
      case 'Escape':
        if (useComments.getState().on) maybeSession()?.shell?.requestCommentMode(false);
        else if (view.findOpen) useFind.getState().close();
        else if (view.textEdit) view.endTextEdit();
        else if (view.cropping) view.setCropping(null);
        else if (view.tool !== 'select') view.setTool('select');
        else if (hasSelection) exitSelection();
        else if (view.canvasEdit) view.editOnCanvas(null);
        else if (useAgent.getState().following) useAgent.getState().follow(null);
        return;
      case 'Delete':
      case 'Backspace':
        if (!editing) return;
        event.preventDefault();
        if (slidesRegion) deleteSlides(targetSlides());
        else if (hasSelection) deleteSelection();
        return;
      case 'Enter':
        if (!onStage) {
          const id = view.slideSelection.at(-1) ?? view.current;
          if (!id) return;
          event.preventDefault();
          if (view.mode === 'canvas') view.editOnCanvas(id);
          else {
            view.setMode('edit');
            view.showSlide(id);
          }
          return;
        }
        event.preventDefault();
        if (event.shiftKey) exitSelection();
        else enterSelection();
        return;
      case 'Tab':
        if (!onStage) return;
        event.preventDefault();
        cycleSelection(event.shiftKey ? -1 : 1);
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = event.shiftKey ? 1 : 8;
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
        event.preventDefault();
        if (onStage && hasSelection && !slidesRegion) {
          if (editing) nudgeSelection(dx, dy);
        } else if (onStage) stepSlide(dx + dy > 0 ? 1 : -1);
        else stepSlide(dx !== 0 ? Math.sign(dx) : Math.sign(dy) * gridColumns());
        return;
      }
      case 'PageUp':
        event.preventDefault();
        stepSlide(-1);
        return;
      case 'PageDown':
        event.preventDefault();
        stepSlide(1);
        return;
      case 'F6': {
        event.preventDefault();
        const bar = document.querySelector<HTMLElement>('[data-open-artifact-format-bar] button, [data-open-artifact-format-bar] input');
        bar?.focus();
        return;
      }
      case '?':
        useUi.getState().open('shortcuts');
        return;
    }
    // ⌥A/H/D/W/V/S align the selection (to the slide when one element is selected).
    const edge = alignEdgeForKey(event);
    if (edge && onStage && editing && hasSelection && !slidesRegion) {
      event.preventDefault();
      if (!event.repeat) alignSelection(edge);
      return;
    }
    if (event.altKey) return;
    if (!onStage) return;
    // Single-letter tools and commands.
    if (lower === 'c' && !event.shiftKey && useComments.getState().available) {
      maybeSession()?.shell?.requestCommentMode(!useComments.getState().on);
      return;
    }
    if (!editing) return;
    if (key === ']') reorderSelection('front');
    else if (key === '[') reorderSelection('back');
    else if (lower === 'k' && hasSelection) useUi.getState().open('scale');
    else if (lower === 't') view.setTool('text');
    else if (lower === 'r') view.setTool(event.shiftKey ? 'rounded' : 'rect');
    else if (lower === 'o') view.setTool('ellipse');
    else if (lower === 'd') view.setTool('diamond');
    else if (lower === 'l') view.setTool(event.shiftKey ? 'connector' : 'line');
    else if (lower === 'v') view.setTool('select');
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** Every slide id in order (⌘A in the rail or grid). */
function targetSlidesAll(): string[] {
  const state = useDeck.getState();
  return Object.keys(state.slides).length ? deckOrderOf() : [];
}

function deckOrderOf(): string[] {
  const state = useDeck.getState();
  return state.index.order.filter((id) => state.slides[id]);
}
