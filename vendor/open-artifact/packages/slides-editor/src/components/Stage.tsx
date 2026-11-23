/**
 * The stage: the slide on show at the current zoom with its speaker notes
 * under it, in-place text editing, the selection overlay and every pointer
 * gesture of the one-slide view (select, move, resize, rotate, marquee,
 * draw, crop, comment, drop files). The find bar's matches are highlighted
 * here too.
 *
 * Fitting leaves room for the floating cards above the slide, the toolbar
 * below it and a line of notes.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import { isAncestorPath, isTextual, nodeAt, pathKey, rotationOf, samePath, SLIDE_HEIGHT, SLIDE_WIDTH, type NodePath, type SlideNode } from '@open-artifact/slides-core';
import { toast } from '@open-artifact/ui';
import { COMMENT_CURSOR } from '@open-artifact/editor-kit/react';
import { SlideView, useElementSize, type RenderOptions } from '../render/SlideView.tsx';
import { useDeck } from '../state/deck.ts';
import { stageScale, useView } from '../state/view.ts';
import { isPlaceable, pickFiles, placeFiles, replaceImage } from '../services/assets.ts';
import { setClipboardRegion } from '../services/clipboard.ts';
import { canChange, editableEntry } from '../services/commands.ts';
import { useComments } from '../services/comments.ts';
import { highlightMatches, useFind } from '../services/find.ts';
import { resolveSrc } from '../services/session.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { NotesEditor } from './NotesPane.tsx';
import { CHROME_BOTTOM, CHROME_TOP } from './StageChrome.tsx';
import { CommentPins } from './comments/CommentPins.tsx';
import { setPendingCaret, TextEditor } from './TextEditor.tsx';
import { toSlidePoint } from './stage/geometry.ts';
import { deepestAt, pickAt, startDraw, startMarquee, startMove, type StageContext } from './stage/gestures.ts';
import { Overlay } from './stage/Overlay.tsx';
import { StageMenuItems } from './stage/StageMenu.tsx';
import { useStageGesture } from './stage/store.ts';

/** Space kept left and right of the slide, px. */
const SIDE = 24;
/** Space above the slide: the top cards, px. */
const TOP = CHROME_TOP;
/** Space below the slide: the bottom toolbar and a gap, px. */
const BOTTOM = CHROME_BOTTOM + 24;
/** Room kept under the slide for the speaker notes, px. */
const NOTES_ROOM = 72;

/** True for the node kinds edited in place. */
function editsInPlace(node: SlideNode): boolean {
  return isTextual(node) || node.kind === 'table';
}

/** The stage of the one-slide view. */
export function Stage(): ReactNode {
  const current = useView((s) => s.current);
  const entry = useDeck((s) => (current ? s.slides[current] : undefined));
  const draft = useStageGesture((s) => s.draft);
  const scale = useView(stageScale);
  const textEdit = useView((s) => s.textEdit);
  const tool = useView((s) => s.tool);
  const commentsOn = useComments((s) => s.on);
  const showNotes = useView((s) => s.showNotes);
  const scroller = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const size = useElementSize(scroller);
  const hoverFrame = useRef(0);

  // Fit the slide to the space it has (and to the deck's size, 16:9 or 4:3).
  const deckSize = useDeck((s) => s.index.size);
  useEffect(() => {
    if (!size || size.w <= 0 || size.h <= 0) return;
    const high = size.h - TOP - BOTTOM - (showNotes ? NOTES_ROOM : 0);
    useView.getState().setFitScale(Math.max(0.05, Math.min((size.w - SIDE * 2) / SLIDE_WIDTH, high / SLIDE_HEIGHT)));
  }, [size, showNotes, deckSize]);

  // The slide's root element (gestures and the overlay measure inside it).
  useLayoutEffect(() => {
    setRoot(rootRef.current);
  });

  // A gesture never outlives the slide it started on.
  useEffect(() => () => useStageGesture.getState().set({ draft: null, move: null, guides: null, marquee: null, draw: null, hover: null }), [current]);

  // ⌘/Ctrl + wheel (and trackpad pinch) zooms.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const view = useView.getState();
      view.setZoom(stageScale(view) * Math.exp(-event.deltaY * 0.01));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const slide = draft && draft.slideId === current ? draft.slide : entry?.slide;
  const ctx = useMemo<StageContext | null>(() => (root && current ? { root, scale, slideId: current } : null), [root, scale, current]);

  const options = useMemo<RenderOptions>(() => {
    const editing = textEdit && textEdit.slideId === current ? textEdit : null;
    return {
      mode: 'edit',
      resolveSrc,
      override: editing
        ? (node, path) =>
            samePath(path, editing.path) && editsInPlace(node) ? (
              <TextEditor key={pathKey(path)} node={node as Parameters<typeof TextEditor>[0]['node']} path={path} slideId={editing.slideId} cell={editing.cell} />
            ) : undefined
        : undefined,
    };
  }, [textEdit, current]);

  useFindHighlights(root, current, slide);

  if (!current || !entry || !slide) {
    return <div className="absolute inset-0 bg-stage" />;
  }

  /* ------------------------------- Pointer ------------------------------- */

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!ctx) return;
    const target = event.target as Element;
    if (target.closest('[data-open-artifact-overlay] .pointer-events-auto, [data-open-artifact-comment-ui], [data-open-artifact-notes]')) return;
    setClipboardRegion('stage');
    const view = useView.getState();
    const stored = useDeck.getState().slides[ctx.slideId]?.slide;
    if (!stored) return;
    // Right button: select what is under the pointer, the menu does the rest.
    if (event.button === 2) {
      const path = pickAt(ctx, stored, event.clientX, event.clientY, view.selection);
      if (path && !view.selection.some((p) => samePath(p, path) || isAncestorPath(p, path))) view.select([path]);
      if (!path && view.selection.length) view.select([]);
      return;
    }
    if (event.button !== 0) return;
    // Typing: clicks inside the text place the caret.
    if (target.closest('[data-open-artifact-editing]')) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !ctx.root.contains(active)) active.blur?.();
    event.preventDefault();
    if (view.textEdit) view.endTextEdit();
    if (view.cropping) view.setCropping(null);

    if (useComments.getState().on) return;
    if (view.tool !== 'select') {
      startDraw(ctx, event, view.tool);
      return;
    }
    const path = pickAt(ctx, stored, event.clientX, event.clientY, view.selection);
    if (!path) {
      startMarquee(ctx, event, event.shiftKey);
      return;
    }
    const selected = view.selection.some((p) => samePath(p, path));
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      if (selected) {
        view.select(view.selection.filter((p) => !samePath(p, path)));
        return;
      }
      view.select([...view.selection, path]);
    } else if (!selected) {
      view.select([path]);
    }
    startMove(ctx, event, useView.getState().selection);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!ctx || useComments.getState().on) return;
    const target = event.target as Element;
    if (target.closest('[data-open-artifact-editing], [data-open-artifact-overlay] .pointer-events-auto, [data-open-artifact-comment-ui], [data-open-artifact-notes]')) return;
    const view = useView.getState();
    const stored = useDeck.getState().slides[ctx.slideId]?.slide;
    if (!stored || view.tool !== 'select') return;
    const selected = view.selection[0];
    const deepest = deepestAt(ctx, stored, event.clientX, event.clientY);
    if (!deepest) return;
    // Inside a selected group: select the element itself first.
    const selectedNode = selected ? nodeAt(stored, selected) : undefined;
    if (selected && selectedNode?.kind === 'box' && isAncestorPath(selected, deepest)) {
      view.select([deepest]);
      return;
    }
    const path = selected && (samePath(selected, deepest) || isAncestorPath(selected, deepest)) ? selected : deepest;
    const node = nodeAt(stored, path);
    if (!node || !editableEntry(ctx.slideId)) return;
    if (isTextual(node)) {
      setPendingCaret({ x: event.clientX, y: event.clientY });
      view.startTextEdit({ slideId: ctx.slideId, path });
    } else if (node.kind === 'table') {
      const cell = target.closest('[data-open-artifact-cell]')?.getAttribute('data-open-artifact-cell')?.split(':').map(Number);
      setPendingCaret({ x: event.clientX, y: event.clientY });
      view.startTextEdit({ slideId: ctx.slideId, path, cell: cell && cell.length === 2 ? [cell[0]!, cell[1]!] : [0, 0] });
    } else if (node.kind === 'image') {
      if (!node.src) {
        void pickFiles('image/png,image/jpeg,image/gif,image/webp,image/svg+xml', false).then((files) => {
          if (files[0]) void replaceImage(path, files[0]);
        });
      } else if (rotationOf(node)) {
        toast.add({ title: 'Straighten the picture to crop it' });
      } else {
        view.select([path]);
        view.setCropping(path);
      }
    } else if (node.kind === 'box' && node.children.length) {
      view.select([deepest]);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // In comment mode the hover is what a click comments on (whatever the tool), as the click picks it.
    const commenting = useComments.getState().on;
    if (!ctx || event.buttons || (!commenting && useView.getState().tool !== 'select')) return;
    const x = event.clientX;
    const y = event.clientY;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      const stored = useDeck.getState().slides[ctx.slideId]?.slide;
      const next = stored ? pickAt(ctx, stored, x, y, commenting ? [] : useView.getState().selection) : null;
      const prev = useStageGesture.getState().hover;
      if (!(prev && next && samePath(prev, next)) && prev !== next) useStageGesture.getState().set({ hover: next });
    });
  };

  /* -------------------------------- Files -------------------------------- */

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files') || !canChange() || !editableEntry(current)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!ctx || !event.dataTransfer.files.length) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter(isPlaceable);
    if (files.length === 0) {
      toast.add({ title: 'Only pictures and video clips can be dropped here' });
      return;
    }
    const stored = useDeck.getState().slides[ctx.slideId]?.slide;
    const hit = stored ? pickAt(ctx, stored, event.clientX, event.clientY, []) : null;
    const hitNode = stored && hit ? nodeAt(stored, hit) : undefined;
    if (hit && hitNode?.kind === 'image' && files.length === 1 && files[0]!.type.startsWith('image/')) {
      void replaceImage(hit, files[0]!);
      return;
    }
    const p = toSlidePoint(ctx.root, event.clientX, event.clientY, ctx.scale);
    void placeFiles(files, { x: Math.min(SLIDE_WIDTH, Math.max(0, p.x)), y: Math.min(SLIDE_HEIGHT, Math.max(0, p.y)) });
  };

  const width = SLIDE_WIDTH * scale;
  const height = SLIDE_HEIGHT * scale;
  // The notes keep a readable width under a small slide, centered on it.
  const notesMin = Math.min(320, (size?.w ?? 0) - 24);
  const cursor = commentsOn ? COMMENT_CURSOR : tool !== 'select' ? 'crosshair' : undefined;

  return (
    <ContextMenu menu={commentsOn ? null : <StageMenuItems />} className="absolute inset-0">
      <div
        ref={scroller}
        data-open-artifact-stage
        className="absolute inset-0 overflow-auto bg-stage outline-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => useStageGesture.getState().set({ hover: null })}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div
          className="flex min-h-full min-w-full flex-col items-center justify-center"
          style={{ paddingTop: TOP, paddingBottom: BOTTOM + (showNotes ? NOTES_ROOM : 0), paddingLeft: SIDE, paddingRight: SIDE, width: 'max-content', height: 'max-content' }}
        >
          <div className="relative shrink-0 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_3px_rgb(0_0_0/0.08)]" style={{ width, height }}>
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }}>
              <SlideView slide={slide} options={options} rootRef={rootRef} />
            </div>
            {ctx ? (
              <Overlay ctx={ctx} slide={slide}>
                <CommentPins ctx={ctx} slide={slide} />
              </Overlay>
            ) : null}
            {slide.hidden ? (
              <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-chrome/90 px-2 py-0.5 text-[11px] text-chrome-secondary shadow-chrome">
                <EyeOff className="size-3" /> Skipped when presenting
              </div>
            ) : null}
            {showNotes ? (
              <div
                data-open-artifact-notes
                className="absolute left-0 top-full"
                style={{ width }}
                onContextMenu={(event) => event.stopPropagation()}
              >
                <div className="mt-2" style={{ width: Math.min(720, Math.max(width, notesMin)), marginLeft: Math.min(0, (width - notesMin) / 2) }}>
                  <NotesEditor
                    key={current}
                    slideId={current}
                    autoGrow
                    className="-mx-1.5 -my-0.5 block w-[calc(100%+12px)] resize-none overflow-hidden rounded-[6px] bg-transparent px-1.5 py-0.5 text-[13px] leading-[18px] text-chrome-secondary outline-none placeholder:text-chrome-muted hover:bg-chrome-hover focus:bg-chrome focus:text-chrome-fg focus:shadow-[0_0_0_1px_var(--color-chrome-accent)]"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ContextMenu>
  );
}

/** Highlights the find bar's matches on the slide on stage. */
function useFindHighlights(root: HTMLElement | null, current: string | null, slide: unknown): void {
  const findOpen = useView((s) => s.findOpen);
  const query = useFind((s) => s.query);
  const match = useFind((s) => s.matches[s.index]);
  useEffect(() => {
    if (!root || !findOpen || !query.trim()) return;
    const here = match && match.slideId === current ? { pathKey: pathKey(match.path as NodePath), occurrence: match.occurrence } : undefined;
    // Wait for the slide to paint before looking for the text.
    const frame = requestAnimationFrame(() => highlightMatches(root, query, here));
    return () => cancelAnimationFrame(frame);
  }, [root, findOpen, query, match, current, slide]);
}
