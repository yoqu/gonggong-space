/**
 * The place ghost: what a placing tool would drop, drawn faintly under the
 * pointer. The Note, Shape and Text tools show the new item
 * at its real size and zoom; the Sticker tool shows its sticker in place of
 * the pointer. The Note and Sticker tools hide the system cursor while the
 * ghost shows, so the pointer becomes the note or sticker; the others keep
 * their crosshair (or text caret) in the ghost's middle.
 *
 * The ghost follows the pointer without re-rendering; it hides off the
 * board, over chrome and while a press runs.
 */

import { ShapeFace } from '../elements/ShapeFace.tsx';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  DEFAULT_STICKER_SIZE,
  FACE_STICKER_ART,
  NOTE_SHADOWS,
  blockColorHex,
  boxShadowCss,
  defaultShapeSize,
  inkColorOnFill,
  noteColorForAuthor,
  type ShapeElement,
  type ShapeKind,
} from '@open-artifact/whiteboard-core';
import { FACE_STICKER_SIZE } from '../lib/votes.ts';
import { canEditBoard, viewerAuthor } from '../services/actions.ts';
import { useCamera } from '../state/camera.ts';
import { useColorScheme } from '../state/theme.ts';
import { effectiveTool, useTool, type StickerChoice } from '../state/tool.ts';
import { NOTE_TEMPLATE_SIZE, TEXT_TEMPLATE_Y } from '../tools/place.ts';
import { StickerGlyph } from '../ui/StickerGlyph.tsx';

/** What the ghost shows. */
type Ghost =
  | { kind: 'note'; tilt: number }
  | { kind: 'shape'; shape: ShapeKind }
  | { kind: 'text' }
  | { kind: 'sticker'; choice: StickerChoice };

/** The ghost of the active tool, if it has one. */
function useGhost(): Ghost | undefined {
  const tool = useTool((state) => effectiveTool(state));
  const commenting = useTool((state) => state.commentMode);
  const shape = useTool((state) => state.shapeKind);
  const tilt = useTool((state) => state.noteTilt);
  const sticker = useTool((state) => state.sticker);
  if (commenting || !canEditBoard()) return undefined;
  switch (tool) {
    case 'note':
      return { kind: 'note', tilt };
    case 'shape':
      return { kind: 'shape', shape };
    case 'text':
      return { kind: 'text' };
    case 'sticker':
      return sticker ? { kind: 'sticker', choice: sticker } : undefined;
    default:
      return undefined;
  }
}

/** The ghost under the pointer (render inside the board surface, above the elements). */
export function PlaceGhost({ surface }: { surface: React.RefObject<HTMLDivElement | null> }) {
  const ghost = useGhost();
  const zoom = useCamera((state) => state.camera.zoom);
  const root = useRef<HTMLDivElement>(null);
  const last = useRef<{ clientX: number; clientY: number; target: EventTarget | null } | null>(null);
  const kind = ghost?.kind;

  useEffect(() => {
    const element = surface.current;
    if (!element || kind === undefined) return;
    let pressing = false;
    const show = (on: boolean): void => {
      element.toggleAttribute('data-wb-ghost', on);
      if (root.current) root.current.style.visibility = on ? 'visible' : 'hidden';
    };
    const place = (): void => {
      const point = last.current;
      if (!point || pressing || !(point.target instanceof Element) || point.target.closest('[data-wb-chrome],[data-no-pan]')) return show(false);
      const bounds = element.getBoundingClientRect();
      const x = point.clientX - bounds.left;
      const y = point.clientY - bounds.top;
      if (root.current) root.current.style.translate = `${x}px ${y}px`;
      show(true);
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      last.current = { clientX: event.clientX, clientY: event.clientY, target: event.target };
      place();
    };
    const onLeave = (): void => {
      last.current = null;
      show(false);
    };
    const onDown = (): void => {
      pressing = true;
      show(false);
    };
    const onUp = (): void => {
      pressing = false;
      place();
    };
    element.addEventListener('pointermove', onMove, { passive: true });
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });
    // The camera moves the board under a still pointer.
    const offCamera = useCamera.subscribe((state, previous) => {
      if (state.camera !== previous.camera) place();
    });
    place();
    return () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      element.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
      offCamera();
      element.removeAttribute('data-wb-ghost');
    };
  }, [surface, kind]);

  if (!ghost) return null;
  return (
    <div ref={root} className="wb-ghost" aria-hidden="true" style={{ visibility: 'hidden' }}>
      {ghost.kind === 'sticker' ? <StickerGhost choice={ghost.choice} zoom={zoom} /> : <div style={{ scale: String(zoom), transformOrigin: '0 0' }}>{<BlockGhost ghost={ghost} />}</div>}
    </div>
  );
}

/** A note, shape or text centered on the pointer, in board units. */
function BlockGhost({ ghost }: { ghost: Exclude<Ghost, { kind: 'sticker' }> }): ReactNode {
  const scheme = useColorScheme();
  if (ghost.kind === 'text') {
    return (
      <div className="wb-el wb-text wb-text-body" style={{ left: 0, top: TEXT_TEMPLATE_Y, '--wb-ink': inkColorOnFill('ink', undefined, scheme) } as React.CSSProperties}>
        Text
      </div>
    );
  }
  if (ghost.kind === 'note') {
    const author = viewerAuthor().id;
    const fill = blockColorHex(author !== null ? noteColorForAuthor(author) : useTool.getState().noteColor);
    const half = NOTE_TEMPLATE_SIZE / 2;
    return (
      <div className="wb-el wb-note" style={{ left: -half, top: -half, width: NOTE_TEMPLATE_SIZE, '--wb-note-fill': fill, '--wb-note-shadow': boxShadowCss(NOTE_SHADOWS[scheme]) } as React.CSSProperties}>
        <div className="wb-note-paper" style={{ minHeight: NOTE_TEMPLATE_SIZE, transform: `rotate(${ghost.tilt}deg)` }} />
      </div>
    );
  }
  const { w, h } = defaultShapeSize(ghost.shape);
  const element: ShapeElement = { type: 'shape', id: '', kind: ghost.shape, x: -w / 2, y: -h / 2, w, h, color: useTool.getState().shapeColor, size: 'body', text: '' };
  return (
    <div className="wb-el wb-shape" style={{ left: -w / 2, top: -h / 2, width: w, height: h }}>
      <ShapeFace element={element} scheme={scheme} />
    </div>
  );
}

/** The armed sticker centered on the pointer, at the size it lands at. */
function StickerGhost({ choice, zoom }: { choice: StickerChoice; zoom: number }): ReactNode {
  const face = choice.art === FACE_STICKER_ART;
  const side = (face ? FACE_STICKER_SIZE : DEFAULT_STICKER_SIZE) * zoom;
  const viewer = viewerAuthor();
  const who = face ? { id: viewer.id ?? '', name: viewer.name ?? '?' } : undefined;
  return (
    <div style={{ position: 'absolute', left: -side / 2, top: -side / 2, width: side, height: side, display: 'grid', placeItems: 'center' }}>
      <StickerGlyph {...(choice.art !== undefined ? { art: choice.art } : {})} {...(choice.glyph !== undefined ? { glyph: choice.glyph } : {})} {...(who ? { who } : {})} size={side * 0.78} />
    </div>
  );
}
