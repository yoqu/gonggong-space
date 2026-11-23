/**
 * The find bar (⌘F, Ctrl+F elsewhere): a small card under the board pill
 * that searches the words on the board as you type, counts the matches,
 * steps through them (Enter / ⇧Enter in the field, ⌘G / ⇧⌘G or F3 / ⇧F3
 * anywhere, the arrow buttons) and tints them in place (`board-find.ts`).
 *
 * ⌘F takes over the browser's own find, which cannot see past the view.
 * ⌘G stays "group" while items are selected on an editable board and the
 * keyboard is on the board; F3 always steps. Escape closes the bar and puts
 * the keyboard back where it was, or on the board when the view moved.
 * A modal dialog or full screen keeps the bar shut.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useIdea } from '../collab/ideas.ts';
import { focusBoardHome } from '../elements/embed-control.ts';
import { isApplePlatform } from '../lib/tools.ts';
import { canEditBoard } from '../services/actions.ts';
import { isTypingTarget } from '../services/keyboard.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useSelection } from '../state/selection.ts';
import { Card, TipGroup, ToolButton } from '../ui/chrome.tsx';
import { createBoardFindAdapter, FIND_BAR_ATTR } from './board-find.ts';
import { createFindController, type FindController } from './find-controller.ts';
import {
  CLOSE_FIND_BAR_LABEL,
  FIND_IN_PAGE_LABEL,
  findCountMessage,
  findCountText,
  findStepDirection,
  findStepDisabledTip,
  isFindShortcut,
  MAX_FIND_QUERY_CHARS,
  NEXT_MATCH_LABEL,
  ownsFindStepChord,
  PREVIOUS_MATCH_LABEL,
  steadyFindStatus,
} from './find-text.ts';

/** Whether a modal dialog or full screen is up (find stays shut). */
function findBlocked(): boolean {
  if (typeof document === 'undefined') return true;
  return document.fullscreenElement != null || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]') !== null;
}

/** Hears when the words on the board may have changed (content, editing, an idea's preview). */
function subscribeBoardWords(listener: () => void): () => void {
  const stops = [
    useBoard.subscribe((state, previous) => {
      if (state.board.content !== previous.board.content) listener();
    }),
    useSelection.subscribe((state, previous) => {
      if (state.editing !== previous.editing) listener();
    }),
    useIdea.subscribe((state, previous) => {
      if (state.hover !== previous.hover || state.idea !== previous.idea) listener();
    }),
  ];
  return () => stops.forEach((stop) => stop());
}

/** The find bar and its keys; mount once the board is ready. */
export function FindBar() {
  const controller = useMemo(() => createFindController(createBoardFindAdapter(subscribeBoardWords)), []);
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);
  const cameraAtOpen = useRef(useCamera.getState().camera);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => () => controller.dispose(), [controller]);

  const close = (): void => {
    setOpen(false);
    controller.clear();
    const from = openedFrom.current;
    openedFrom.current = null;
    const moved = useCamera.getState().camera !== cameraAtOpen.current;
    if (!moved && from?.isConnected) from.focus({ preventScroll: true });
    else focusBoardHome();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const apple = isApplePlatform();
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing || event.defaultPrevented) return;
      if (isFindShortcut(event, apple)) {
        if (findBlocked()) return;
        event.preventDefault();
        event.stopPropagation();
        if (!openRef.current) {
          const active = document.activeElement;
          openedFrom.current = active instanceof HTMLElement && active !== document.body ? active : null;
          cameraAtOpen.current = useCamera.getState().camera;
          setOpen(true);
        }
        requestAnimationFrame(() => {
          fieldRef.current?.focus();
          fieldRef.current?.select();
        });
        return;
      }
      const direction = findStepDirection(event, apple);
      if (direction === undefined || !openRef.current || findBlocked()) return;
      const typing = isTypingTarget(event.target);
      if (!ownsFindStepChord(event, { selected: useSelection.getState().ids.length, editable: canEditBoard(), typing })) return;
      event.preventDefault();
      event.stopPropagation();
      controller.step(direction);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [controller]);

  if (!open) return null;
  return <FindBarCard controller={controller} fieldRef={fieldRef} onClose={() => closeRef.current()} />;
}

/** The card itself: field, counter, step and close buttons. */
function FindBarCard({ controller, fieldRef, onClose }: { controller: FindController; fieldRef: RefObject<HTMLInputElement | null>; onClose: () => void }) {
  const readStatus = useMemo(() => steadyFindStatus(controller.status), [controller]);
  const status = useSyncExternalStore(controller.subscribe, readStatus, readStatus);
  const [query, setQuery] = useState('');
  const count = findCountText(status);
  const nothingFound = status.total === 0;
  const disabledTip = findStepDisabledTip(status);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // The bar's keys are its own: none reach the board's shortcuts.
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter' && event.target === fieldRef.current) {
      event.preventDefault();
      controller.step(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <Card
      role="search"
      aria-label={FIND_IN_PAGE_LABEL}
      {...{ [FIND_BAR_ATTR]: '' }}
      className="wb-find-bar p-[5px]"
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <TipGroup>
        <input
          ref={fieldRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!(event.nativeEvent as InputEvent).isComposing) controller.setQuery(event.target.value);
          }}
          onCompositionEnd={(event) => controller.setQuery(event.currentTarget.value)}
          placeholder={FIND_IN_PAGE_LABEL}
          aria-label={FIND_IN_PAGE_LABEL}
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_FIND_QUERY_CHARS}
          className="h-7 min-w-0 flex-1 rounded-[8px] bg-chrome-field px-2 text-[14px] text-chrome-fg outline-none ring-1 ring-inset ring-chrome-line placeholder:text-chrome-muted focus-visible:ring-2 focus-visible:ring-chrome-accent pointer-coarse:h-10"
        />
        <span role="status" aria-atomic="true" className="min-w-[3.5em] whitespace-nowrap text-end text-[12px] tabular-nums text-chrome-muted">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{count === '' ? '' : findCountMessage(status.current, status.total, status.capped)}</span>
        </span>
        <ToolButton size="md" tipSide="bottom" label={PREVIOUS_MATCH_LABEL} tip={nothingFound ? (disabledTip ?? PREVIOUS_MATCH_LABEL) : PREVIOUS_MATCH_LABEL} icon={<ArrowUp />} aria-disabled={nothingFound} className="aria-disabled:opacity-40" onClick={() => !nothingFound && controller.step(-1)} />
        <ToolButton size="md" tipSide="bottom" label={NEXT_MATCH_LABEL} tip={nothingFound ? (disabledTip ?? NEXT_MATCH_LABEL) : NEXT_MATCH_LABEL} icon={<ArrowDown />} aria-disabled={nothingFound} className="aria-disabled:opacity-40" onClick={() => !nothingFound && controller.step(1)} />
        <ToolButton size="md" tipSide="bottom" label={CLOSE_FIND_BAR_LABEL} icon={<X />} onClick={onClose} />
      </TipGroup>
    </Card>
  );
}
