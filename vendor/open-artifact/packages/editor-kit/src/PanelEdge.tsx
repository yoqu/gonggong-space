/**
 * A panel's edge that resizes it: drag it, or with it focused press the arrow keys (Shift for bigger steps); a double
 * click puts the panel back to its first width. `usePanelWidth` keeps the width per panel in this browser.
 */
import { cn } from '@open-artifact/ui';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useRef, useState } from 'react';

const STEP = 8;
const BIG_STEP = 32;

export interface PanelEdgeProps {
  label: string;
  width: number;
  min: number;
  max: number;
  /** Which of the panel's sides the edge is on. */
  side: 'left' | 'right';
  onResize(width: number): void;
  onReset?(): void;
  className?: string;
}

export function PanelEdge({ label, width, min, max, side, onResize, onReset, className }: PanelEdgeProps): ReactNode {
  const start = useRef<{ x: number; width: number } | null>(null);
  const grow = side === 'left' ? -1 : 1;
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onResize(start.current.width + (event.clientX - start.current.x) * grow);
  };
  const up = () => {
    start.current = null;
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (start.current || event.metaKey || event.ctrlKey || event.altKey) return;
    const toward = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!toward) return;
    event.preventDefault();
    event.stopPropagation();
    onResize(width + toward * grow * (event.shiftKey ? BIG_STEP : STEP));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className={cn(
        'absolute inset-y-0 z-10 w-2 cursor-col-resize outline-none pointer-coarse:hidden',
        'hover:bg-[linear-gradient(to_right,transparent_3px,var(--color-chrome-accent)_3px,var(--color-chrome-accent)_5px,transparent_5px)]',
        'focus-visible:bg-[linear-gradient(to_right,transparent_3px,var(--color-chrome-accent)_3px,var(--color-chrome-accent)_5px,transparent_5px)]',
        side === 'left' ? '-left-1' : '-right-1',
        className,
      )}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onReset}
    />
  );
}

function readWidth(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeWidth(key: string, width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // A browser that keeps nothing still resizes for the visit.
  }
}

export interface PanelWidth {
  width: number;
  resize(width: number): void;
  reset(): void;
}

/** A panel's width between `min` and `max` (and never wider than `cap`, when given), kept in this browser under `key`. */
export function usePanelWidth(key: string, initial: number, min: number, max: number, cap = Infinity): PanelWidth {
  const clamp = useCallback((value: number) => Math.round(Math.max(min, Math.min(max, cap, value))), [min, max, cap]);
  const [stored, setStored] = useState(() => readWidth(key) ?? initial);
  const resize = useCallback(
    (value: number) => {
      const next = clamp(value);
      setStored(next);
      writeWidth(key, next);
    },
    [clamp, key],
  );
  const reset = useCallback(() => {
    setStored(initial);
    writeWidth(key, null);
  }, [initial, key]);
  return { width: clamp(stored), resize, reset };
}
