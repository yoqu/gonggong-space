/**
 * {@link ScrubNumberField}: a number field whose label is dragged sideways
 * to change the value, the way design tools do it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { clampNumber, evaluateNumberInput, formatNumber, roundTo, snapToStep, stepDecimals, stepStart } from './numbers.ts';

/** Props of {@link ScrubNumberField}. */
export interface ScrubNumberFieldProps {
  /** The value; null shows the field empty (with `placeholder`). */
  value: number | null;
  /** Several selected things differ: show "Mixed" until a value is entered. */
  mixed?: boolean;
  /** Live value while scrubbing or stepping with held keys. */
  onChange?: (value: number) => void;
  /**
   * Final value: typed and committed (Enter or blur), stepped with a key, or
   * at the end of a scrub. `unit` is set when the user typed one of `units`.
   */
  onCommit: (value: number, unit?: string) => void;
  /** Accessible name (required: the label may be an icon). */
  'aria-label': string;
  /** The drag handle at the start: a letter (`W`, `X`) or an icon. Without it the field has no scrub handle. */
  label?: ReactNode;
  /** Unit shown after the number (`px`, `%`, `°`). Typing it is allowed. */
  unit?: string;
  /** Other units the user may type (`em`, `rem`); a typed one is passed to `onCommit`. */
  units?: readonly string[];
  min?: number;
  max?: number;
  /** Arrow-key and scrub step (default 1). */
  step?: number;
  /** Shift + arrow and Page Up/Down step (default 10 × step). */
  largeStep?: number;
  /** Alt + arrow step (default step / 10). */
  smallStep?: number;
  /** Decimals kept (default: those of the smallest step). */
  precision?: number;
  /** Pixels of drag per step (default 2). */
  pixelsPerStep?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Tooltip of the drag handle. */
  title?: string;
}

/**
 * A number field with a drag-to-scrub label.
 *
 * - Drag the label sideways to scrub (Shift: large steps, Alt: small
 *   steps); values land on multiples of `step` unless Alt is held. Escape
 *   during a drag puts the value back; the end of a drag leaves the field
 *   focused with its text selected. Pressing the label commits any other
 *   field being typed in first.
 * - Arrow Up/Down step (Shift ×10, Alt ÷10), Page Up/Down take large
 *   steps, Home/End go to `min`/`max`. An empty or mixed field steps
 *   from 0 (kept within `min`/`max`).
 * - Typing accepts arithmetic (`12*2`, `100/3`) and a unit; Enter or blur
 *   commits, Escape reverts.
 * - `mixed` shows "Mixed" until something is entered.
 */
export function ScrubNumberField({
  value,
  mixed = false,
  onChange,
  onCommit,
  label,
  unit,
  units,
  min,
  max,
  step = 1,
  largeStep,
  smallStep,
  precision,
  pixelsPerStep = 2,
  placeholder,
  disabled,
  className,
  title,
  ...aria
}: ScrubNumberFieldProps) {
  const big = largeStep ?? step * 10;
  const small = smallStep ?? step / 10;
  const decimals = precision ?? Math.max(stepDecimals(step), stepDecimals(small));
  const shown = (v: number | null) => (v === null || mixed ? '' : formatNumber(v, decimals));
  const [draft, setDraft] = useState(() => shown(value));
  const [scrubbing, setScrubbing] = useState(false);
  const editing = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  /** The value at the start of a scrub, and the drag so far. */
  const scrub = useRef<{ start: number; current: number; travel: number; carry: number; pointerId: number } | null>(null);

  // Follow outside changes unless the user is typing.
  useEffect(() => {
    if (!editing.current) setDraft(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mixed, decimals]);

  const fit = (v: number) => roundTo(clampNumber(v, min, max), decimals);

  const commitText = () => {
    editing.current = false;
    const text = draft.trim();
    if (!text) {
      setDraft(shown(value));
      return;
    }
    const typed = evaluateNumberInput(text);
    const typedUnit = typed?.unit;
    const allowed = typedUnit === undefined || typedUnit === unit?.toLowerCase() || units?.some((u) => u.toLowerCase() === typedUnit);
    if (!typed || !allowed) {
      setDraft(shown(value));
      return;
    }
    const next = fit(typed.value);
    const otherUnit = typedUnit !== undefined && typedUnit !== unit?.toLowerCase() ? typedUnit : undefined;
    setDraft(formatNumber(next, decimals));
    if (next !== value || mixed || otherUnit) onCommit(next, otherUnit);
  };

  /** Puts `target` (fitted) in the field and commits it. */
  const settleAt = (target: number) => {
    const next = fit(target);
    editing.current = false;
    setDraft(formatNumber(next, decimals));
    onChange?.(next);
    onCommit(next);
  };

  /** Steps from the text being typed, else the value, else {@link stepStart}. */
  const stepBy = (delta: number) => {
    const typed = editing.current ? evaluateNumberInput(draft) : null;
    settleAt((typed?.value ?? (mixed || value === null ? stepStart(min, max) : value)) + delta);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const unitStep = event.shiftKey ? big : event.altKey ? small : step;
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        stepBy(unitStep);
        break;
      case 'ArrowDown':
        event.preventDefault();
        stepBy(-unitStep);
        break;
      case 'PageUp':
        event.preventDefault();
        stepBy(big);
        break;
      case 'PageDown':
        event.preventDefault();
        stepBy(-big);
        break;
      case 'Home':
        if (min !== undefined && !event.shiftKey) {
          event.preventDefault();
          settleAt(min);
        }
        break;
      case 'End':
        if (max !== undefined && !event.shiftKey) {
          event.preventDefault();
          settleAt(max);
        }
        break;
      case 'Enter':
        event.preventDefault();
        commitText();
        event.currentTarget.select();
        break;
      case 'Escape':
        if (editing.current) {
          event.preventDefault();
          event.stopPropagation();
          editing.current = false;
          setDraft(shown(value));
        }
        break;
    }
  };

  /* --------------------------------- scrub -------------------------------- */

  const endScrub = (target: HTMLElement, commit: boolean) => {
    const state = scrub.current;
    if (!state) return;
    scrub.current = null;
    setScrubbing(false);
    if (target.hasPointerCapture(state.pointerId)) target.releasePointerCapture(state.pointerId);
    if (!commit) {
      setDraft(shown(value));
      if (state.current !== state.start) onChange?.(state.start);
      return;
    }
    // A click on the label, or the end of a drag, leaves the field focused and selected.
    inputRef.current?.focus();
    inputRef.current?.select();
    if (state.travel < pixelsPerStep) return;
    if (state.current !== state.start || mixed) onCommit(state.current);
  };

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    // A field typed into elsewhere commits before the scrub writes its own value.
    const typing = document.activeElement;
    if (typing instanceof HTMLElement && typing !== inputRef.current && (typing.matches('input, textarea') || typing.isContentEditable)) typing.blur();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = mixed || value === null ? stepStart(min, max) : value;
    scrub.current = { start, current: start, travel: 0, carry: 0, pointerId: event.pointerId };
  };

  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const state = scrub.current;
    if (!state || event.pointerId !== state.pointerId) return;
    state.travel += Math.abs(event.movementX);
    // Movement below a step carries over, so slow drags still move.
    state.carry += event.movementX;
    if (state.travel < pixelsPerStep) return;
    if (!scrubbing) setScrubbing(true);
    const steps = Math.trunc(state.carry / pixelsPerStep);
    if (steps === 0) return;
    state.carry -= steps * pixelsPerStep;
    const unitStep = event.shiftKey ? big : event.altKey ? small : step;
    const moved = state.current + steps * unitStep;
    const next = fit(event.altKey ? moved : snapToStep(moved, step));
    if (next === state.current) return;
    state.current = next;
    setDraft(formatNumber(next, decimals));
    onChange?.(next);
  };

  useEffect(() => {
    if (!scrubbing) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !scrub.current) return;
      event.preventDefault();
      const handle = document.querySelector<HTMLElement>(`[data-scrub-for="${CSS.escape(inputId)}"]`);
      if (handle) endScrub(handle, false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubbing]);

  const numeric = value !== null && !mixed ? roundTo(value, decimals) : undefined;

  return (
    <div
      data-ui-field=""
      className={cn(
        'flex h-7 min-w-0 items-center rounded-control border border-line bg-surface-2 text-[13px] text-fg focus-within:border-accent focus-within:bg-surface',
        disabled && 'opacity-50',
        scrubbing && 'border-accent',
        className,
      )}
    >
      {label !== undefined ? (
        <span
          aria-hidden="true"
          data-scrub-for={inputId}
          title={title ?? 'Drag to change'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endScrub(event.currentTarget, true)}
          onPointerCancel={(event) => endScrub(event.currentTarget, false)}
          onLostPointerCapture={(event) => scrub.current && endScrub(event.currentTarget, true)}
          className={cn(
            'flex h-full min-w-6 shrink-0 select-none items-center justify-center px-1 text-[11px] text-fg-subtle touch-none',
            disabled ? 'cursor-default' : 'cursor-ew-resize hover:text-fg',
          )}
        >
          {label}
        </span>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        role="spinbutton"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={aria['aria-label']}
        aria-valuenow={numeric}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={mixed ? 'Mixed' : numeric !== undefined ? `${formatNumber(numeric, decimals)}${unit ?? ''}` : undefined}
        disabled={disabled}
        value={draft}
        placeholder={mixed ? 'Mixed' : placeholder}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          editing.current = true;
          setDraft(event.target.value);
        }}
        onBlur={commitText}
        onKeyDown={onKeyDown}
        className={cn('h-full w-full min-w-0 bg-transparent tabular-nums outline-none placeholder:text-fg-subtle', label === undefined && 'pl-2', !unit && 'pr-2')}
      />
      {unit ? <span className="shrink-0 pr-2 text-[11px] text-fg-subtle">{unit}</span> : null}
    </div>
  );
}
