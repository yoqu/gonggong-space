/**
 * The mark of an idea the agent left for this viewer (screen units), next
 * to what the idea is about. Hovering or clicking opens its menu: what the
 * agent says, the options (hover previews one on the board, a click
 * applies it, a second click takes it off) and Clear.
 *
 * Everything in the idea is untrusted: rendered as text.
 */

import { Check, Lightbulb, Sparkles, X } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { elementBounds, unionBounds, type BoardElement, type Box } from '@open-artifact/whiteboard-core';
import { cn } from '@open-artifact/ui';
import { boardToScreen } from '../lib/camera.ts';
import { maybeSession } from '../services/session.ts';
import { viewCenter } from '../services/navigation.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useMeasures } from '../state/measures.ts';
import { ChromeButton, ChromePopover } from '../ui/chrome.tsx';
import { ideaVersionTouches } from './idea-edits.ts';
import { clearIdea, makeIdeaOption, toggleIdeaOption, useIdea } from './ideas.ts';

/** Delay before hovering the mark opens its menu (ms). */
export const IDEA_HOVER_OPEN_MS = 240;

/** The board box an idea is about: its `about` elements, else what its options touch. */
function ideaBox(about: readonly string[], touched: ReadonlySet<string>, byId: ReadonlyMap<string, BoardElement>, measures: ReturnType<typeof useMeasures.getState>['measures']): Box | undefined {
  const boxesOf = (ids: Iterable<string>): Box[] => {
    const boxes: Box[] = [];
    for (const id of ids) {
      const element = byId.get(id);
      const box = element ? elementBounds(element, measures) : undefined;
      if (box) boxes.push(box);
    }
    return boxes;
  };
  const primary = boxesOf(about);
  const boxes = primary.length > 0 ? primary : boxesOf(touched);
  return boxes.length > 0 ? unionBounds(boxes) : undefined;
}

/** The idea mark and its menu (renders nothing without an idea). */
export function IdeaMark() {
  const idea = useIdea((state) => state.idea);
  const menuOpen = useIdea((state) => state.menuOpen);
  const applied = useIdea((state) => state.applied);
  const byId = useBoard((state) => state.byId);
  const measures = useMeasures((state) => state.measures);
  const camera = useCamera((state) => state.camera);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const canEdit = maybeSession()?.canEdit ?? false;

  const box = useMemo(() => {
    if (!idea) return undefined;
    const touched = new Set<string>();
    for (const option of idea.options) for (const id of ideaVersionTouches(option.version)) touched.add(id);
    return ideaBox(idea.about, touched, byId, measures);
  }, [idea, byId, measures]);

  if (!idea) return null;
  const anchor = box ? { x: box.x + box.w, y: box.y } : viewCenter();
  const at = boardToScreen(camera, anchor);
  const stopHover = (): void => {
    if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  };

  return (
    <ChromePopover
      open={menuOpen}
      onOpenChange={(open) => useIdea.getState().setMenuOpen(open)}
      side="right"
      align="start"
      label="Idea from the agent"
      trigger={
        <button
          type="button"
          data-wb-chrome=""
          className={cn('wb-idea-mark', !idea.ended && 'wb-idea-streaming')}
          style={{ transform: `translate(${at.x + 6}px, ${at.y - 34}px)` }}
          aria-label="Idea from the agent"
          onPointerEnter={() => {
            stopHover();
            hoverTimer.current = setTimeout(() => useIdea.getState().setMenuOpen(true), IDEA_HOVER_OPEN_MS);
          }}
          onPointerLeave={stopHover}
        >
          <Lightbulb aria-hidden="true" className="size-4" />
        </button>
      }
    >
      <div className="flex w-80 max-w-full flex-col gap-2 p-1" onPointerLeave={() => useIdea.getState().setHover(null)}>
        <p className="whitespace-pre-wrap break-words" dir="auto">{idea.says}</p>
        {idea.options.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label="Options">
            {idea.options.map((option, index) => {
              const on = applied.has(index);
              const ready = option.version !== undefined && option.version.edits.length > 0;
              return (
                <li key={`${index}:${option.label}`}>
                  <ChromeButton
                    pressed={on}
                    disabled={!canEdit || !ready}
                    aria-description={option.version?.why}
                    title={option.version?.why}
                    className="h-auto min-h-8 w-full justify-start py-1 text-left whitespace-normal"
                    onPointerEnter={() => useIdea.getState().setHover(index)}
                    onFocus={() => useIdea.getState().setHover(index)}
                    onBlur={() => useIdea.getState().setHover(null)}
                    onClick={() => (option.later ? void makeIdeaOption(index) : toggleIdeaOption(index))}
                  >
                    {on ? <Check aria-hidden="true" /> : option.later ? <Sparkles aria-hidden="true" /> : <span className="inline-block size-[18px]" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 break-words" dir="auto">{option.label}</span>
                    {option.version === undefined ? <span className="text-[12px] text-chrome-muted">Preparing…</span> : null}
                  </ChromeButton>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <ChromeButton onClick={clearIdea}>
            <X aria-hidden="true" />
            Clear
          </ChromeButton>
        </div>
      </div>
    </ChromePopover>
  );
}
