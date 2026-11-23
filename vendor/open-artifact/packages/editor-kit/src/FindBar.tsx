/**
 * The find bar: a search field, "n of m", previous / next and close. Enter
 * goes to the next match, ⇧Enter to the previous one, Escape closes. The
 * editor renders it while find is open and passes its find store's state.
 */

import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Card, ChromeButton, Tip } from './chrome.tsx';

/** Props of {@link FindBar}. */
export interface FindBarProps {
  /** Label and placeholder of the field ("Find in design"). */
  label: string;
  query: string;
  count: number;
  /** The match shown, or -1. */
  index: number;
  onQuery(query: string): void;
  onStep(delta: 1 | -1): void;
  onClose(): void;
  /** A window event (⌘F while open) that focuses the field again. */
  focusEvent: string;
  /** Classes of the card (placement). */
  className?: string;
  /** Label of the close button (default "Close"). */
  closeLabel?: string;
  /** F3 / ⇧F3 step too. */
  f3?: boolean;
  /** Escape stops at the field (the editor's own Escape handling never sees it). */
  stopEscape?: boolean;
  /** Announce "n of m" through a polite live region. */
  liveStatus?: boolean;
}

export function FindBar({ label, query, count, index, onQuery, onStep, onClose, focusEvent, className, closeLabel = 'Close', f3, stopEscape, liveStatus }: FindBarProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = (): void => {
      input.current?.focus();
      input.current?.select();
    };
    focus();
    window.addEventListener(focusEvent, focus);
    return () => window.removeEventListener(focusEvent, focus);
  }, [focusEvent]);

  const status = !query.trim() ? '' : count === 0 ? 'No results' : `${index + 1} of ${count}`;

  return (
    <Card role="search" className={className}>
      <Search className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
      <input
        ref={input}
        aria-label={label}
        placeholder={label}
        value={query}
        className="w-48 bg-transparent text-[13px] text-chrome-fg outline-none placeholder:text-chrome-muted"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || (f3 && event.key === 'F3')) {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            if (stopEscape) event.stopPropagation();
            onClose();
          }
        }}
      />
      <span aria-live={liveStatus ? 'polite' : undefined} className="min-w-14 text-right text-[12px] tabular-nums text-chrome-muted">
        {status}
      </span>
      <Tip label="Previous match" shortcut="⇧↵">
        <ChromeButton square aria-label="Previous match" disabled={count === 0} onClick={() => onStep(-1)}>
          <ChevronUp className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      </Tip>
      <Tip label="Next match" shortcut="↵">
        <ChromeButton square aria-label="Next match" disabled={count === 0} onClick={() => onStep(1)}>
          <ChevronDown className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      </Tip>
      <Tip label="Close" shortcut="Esc">
        <ChromeButton square aria-label={closeLabel} onClick={onClose}>
          <X className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      </Tip>
    </Card>
  );
}
