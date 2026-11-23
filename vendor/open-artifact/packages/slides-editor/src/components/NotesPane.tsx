/**
 * Speaker notes of a slide: plain text (≤ 4,000 characters), edited under
 * the slide on stage and in the presenter views. Notes are never shown on
 * the slide; everyone who can open the deck can read them. Typing coalesces
 * into one undo step per pause, like other text edits.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LIMITS, setNotes } from '@open-artifact/slides-core';
import { useDeck } from '../state/deck.ts';
import { changeSlide, editableEntry } from '../services/commands.ts';

/** Props of {@link NotesEditor}. */
export interface NotesEditorProps {
  slideId: string;
  className?: string;
  autoFocus?: boolean;
  /** Grow with the text instead of filling the parent's height. */
  autoGrow?: boolean;
}

/** The notes editor of one slide. */
export function NotesEditor({ slideId, className, autoFocus, autoGrow = false }: NotesEditorProps): ReactNode {
  const notes = useDeck((s) => s.slides[slideId]?.slide.notes ?? '');
  const editable = useDeck((s) => !s.readOnly) && editableEntry(slideId) !== null;
  // A local draft keeps the caret steady while saves and remote merges land.
  const [draft, setDraft] = useState(notes);
  const focused = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused.current) setDraft(notes);
  }, [notes]);

  // Auto-grow: the height follows the text (and the width it wraps at).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoGrow || !el) return;
    const fit = (): void => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoGrow, draft]);

  return (
    <textarea
      ref={ref}
      rows={autoGrow ? 1 : undefined}
      aria-label="Speaker notes"
      autoFocus={autoFocus}
      readOnly={!editable}
      value={draft}
      maxLength={LIMITS.notes}
      placeholder={editable ? 'Speaker notes. Never shown on the slide.' : 'No speaker notes on this slide.'}
      className={className ?? 'h-full w-full resize-none bg-transparent px-4 py-2 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle'}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(useDeck.getState().slides[slideId]?.slide.notes ?? '');
      }}
      onChange={(event) => {
        const text = event.target.value.slice(0, LIMITS.notes);
        setDraft(text);
        changeSlide(slideId, 'Edit notes', (slide) => (slide.notes === text ? null : setNotes(slide, text)), { coalesce: `notes:${slideId}` });
      }}
      onKeyDown={(event) => {
        // Escape hands focus back to the stage.
        if (event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
