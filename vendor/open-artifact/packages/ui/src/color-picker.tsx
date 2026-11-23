/**
 * Color picking: {@link ColorPicker} (a trigger and popover) and
 * {@link ColorPickerPanel} (the popover's body, for embedding): a
 * saturation/brightness area, hue and alpha sliders, a format switcher
 * (hex, rgb, hsl, oklch), a text field, the browser's eyedropper, swatches
 * (design tokens) and recent colors, and an optional WCAG contrast check.
 */
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Pipette, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from './cn.ts';
import {
  colorRevertMessage,
  contrastLevel,
  contrastRatio,
  contrastTarget,
  editFormat,
  formatColor,
  hsvaToRgba,
  hueName,
  parseColor,
  readableShade,
  rgbaToHsva,
  sameColor,
  withHexHash,
  type ColorFormat,
  type ColorNotation,
  type Hsva,
} from './color.ts';
import { CommitInput, Segmented } from './fields.tsx';
import { preventRepeatedActivation } from './keys.ts';
import { POPUP_CLASS } from './menu.tsx';

/** A checkerboard, under translucent colors. */
export const CHECKERBOARD = 'repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 0 0 / 8px 8px';

/** A color offered as a swatch (a design token, a brand color). */
export interface ColorSwatch {
  /** Shown as the tooltip and accessible name (`primary`, `blue-500`). */
  name: string;
  /** The color to show (any CSS color). */
  value: string;
  /** Heading the swatch is grouped under. */
  group?: string;
  /** What picking it writes, when not `value` (e.g. `var(--primary)`). */
  css?: string;
}

/* ------------------------------ recent colors ----------------------------- */

const RECENT_KEY = 'open-artifact.recent-colors';
const RECENT_MAX = 12;
let recent: string[] | null = null;
const recentListeners = new Set<() => void>();

function readRecent(): string[] {
  if (recent) return recent;
  recent = [];
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? '[]') as unknown;
    if (Array.isArray(stored)) recent = stored.filter((item): item is string => typeof item === 'string').slice(0, RECENT_MAX);
  } catch {
    // Storage may be blocked; recents then last for the page.
  }
  return recent;
}

/** Adds a color to the shared recent colors (most recent first, no repeats, 12 kept). */
export function pushRecentColor(color: string): void {
  const text = color.trim();
  if (!text) return;
  const list = readRecent();
  recent = [text, ...list.filter((item) => !sameColor(item, text))].slice(0, RECENT_MAX);
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Ignored: see readRecent.
  }
  recentListeners.forEach((listener) => listener());
}

/** The shared recent colors (kept in local storage per browser). */
export function useRecentColors(): string[] {
  return useSyncExternalStore(
    (listener) => {
      recentListeners.add(listener);
      return () => recentListeners.delete(listener);
    },
    readRecent,
    () => [],
  );
}

/* --------------------------------- contrast -------------------------------- */

/** Props of {@link ContrastBadge}. */
export interface ContrastBadgeProps {
  /** The text or icon color. */
  color: string;
  /** What it sits on. */
  against: string;
  /** Level aimed for (default AA). */
  level?: 'AA' | 'AAA';
  /** Large text (≥ 24px, or ≥ 18.66px bold) and UI parts need less. */
  large?: boolean;
  /** Called with a passing shade when the user asks for one. */
  onFix?: (color: string) => void;
  className?: string;
}

/**
 * The contrast of `color` on `against`: "Contrast 7.2:1" with the WCAG level
 * reached, or "Contrast poor, 2.1:1" and a fix when below the target.
 * Renders nothing when either color cannot be read (a `var()`).
 */
export function ContrastBadge({ color, against, level = 'AA', large = false, onFix, className }: ContrastBadgeProps) {
  const ratio = contrastRatio(color, against);
  if (ratio === null) return null;
  const target = contrastTarget(level, large);
  const reached = contrastLevel(ratio, large);
  const passes = ratio >= target;
  const shown = `${(Math.floor(ratio * 100) / 100).toFixed(2).replace(/\.?0+$/, '')}:1`;
  const fix = !passes && onFix ? readableShade(color, against, target) : null;
  return (
    <div className={cn('flex min-w-0 items-center gap-2 text-xs', className)} role="status">
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[11px] font-semibold shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
        style={{ background: `linear-gradient(${against}, ${against}), ${CHECKERBOARD}`, color }}
      >
        Aa
      </span>
      <span className={cn('min-w-0 flex-1 truncate', passes ? 'text-fg-muted' : 'text-warning')}>
        {passes ? `Contrast ${shown}` : `Contrast poor, ${shown}`}
      </span>
      <span
        className={cn(
          'shrink-0 rounded px-1 py-px text-[10px] font-semibold',
          passes ? 'bg-accent-soft text-accent' : 'bg-hover text-warning',
        )}
        title={`WCAG ${level}${large ? ' (large text)' : ''} needs ${target}:1`}
      >
        {reached === 'Fail' ? 'Fail' : reached}
      </span>
      {fix ? (
        <button
          type="button"
          onClick={() => onFix?.(fix)}
          onKeyDown={preventRepeatedActivation}
          className="shrink-0 rounded px-1 text-accent outline-none hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          title={`Use ${fix}`}
        >
          Fix
        </button>
      ) : null}
    </div>
  );
}

/* --------------------------------- picker --------------------------------- */

/** Props of {@link ColorPickerPanel}. */
export interface ColorPickerPanelProps {
  /** The color as written (any CSS color, a `var()`), or null for none. */
  value: string | null;
  /** Live updates while dragging. */
  onChange: (value: string) => void;
  /** Final values: drag released, text entered, swatch or format picked. Defaults to `onChange`'s value only. */
  onCommit?: (value: string) => void;
  /** Where the picker starts when `value` is null or not a plain color (e.g. the inherited color). */
  fallback?: string | null;
  /** Notation of new values while `value` gives none (default: the value's own, else hex). */
  format?: ColorFormat;
  /** Offer the alpha slider (default true). */
  alpha?: boolean;
  /** Swatches (e.g. design tokens), grouped by `group`. */
  swatches?: readonly ColorSwatch[];
  /**
   * Recent colors. Omit to use the shared list (stored per browser and
   * updated on commit), pass a list to show your own, or `false` to hide.
   */
  recent?: readonly string[] | false;
  /** Show the contrast of the color on this background. */
  contrastAgainst?: string | null;
  /** Contrast level aimed for (default AA). */
  contrastLevel?: 'AA' | 'AAA';
  /** The color is for large text or UI parts (lower contrast targets). */
  largeText?: boolean;
  /** Offer a "None" button that calls this. */
  onClear?: () => void;
  className?: string;
}

/** Calls `fn` at most once per animation frame with the latest value. */
function useFrameThrottle<T>(fn: (value: T) => void): { call: (value: T) => void; flush: () => void } {
  const latest = useRef<{ value: T } | null>(null);
  const frame = useRef<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (latest.current) fnRef.current(latest.current.value);
    latest.current = null;
  }, []);
  const call = useCallback((value: T) => {
    latest.current = { value };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (latest.current) fnRef.current(latest.current.value);
      latest.current = null;
    });
  }, []);
  return { call, flush };
}

const FORMAT_OPTIONS: { value: ColorFormat; label: string; title: string }[] = [
  { value: 'hex', label: 'HEX', title: 'Hex' },
  { value: 'rgb', label: 'RGB', title: 'RGB' },
  { value: 'hsl', label: 'HSL', title: 'HSL' },
  { value: 'oklch', label: 'OKLCH', title: 'OKLCH' },
];

const BLACK_HSVA: Hsva = { h: 0, s: 0, v: 0, a: 1 };

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}

/** The picker body: area, sliders, format, text, eyedropper, swatches, recents, contrast. */
export function ColorPickerPanel({
  value,
  onChange,
  onCommit,
  fallback,
  format: formatProp,
  alpha = true,
  swatches,
  recent: recentProp,
  contrastAgainst,
  contrastLevel: level = 'AA',
  largeText = false,
  onClear,
  className,
}: ColorPickerPanelProps) {
  const parsed = useMemo(() => (value ? parseColor(value) : null), [value]);
  const [format, setFormat] = useState<ColorFormat>(() => (parsed ? editFormat(parsed.notation) : (formatProp ?? 'hex')));
  /** Notation details kept while the format stays the value's own (commas, hex case). */
  const notation: Omit<ColorNotation, 'format'> = parsed && editFormat(parsed.notation) === format && parsed.notation.format !== 'named' ? parsed.notation : {};
  const [hsva, setHsva] = useState<Hsva>(() => {
    const start = parsed ?? (fallback ? parseColor(fallback) : null);
    return start ? rgbaToHsva(start.rgba) : BLACK_HSVA;
  });
  /** The last text this panel emitted, so its own echo does not reset the hue. */
  const emitted = useRef<string | null>(null);
  const sharedRecent = useRecentColors();
  const recentColors = recentProp === false ? [] : (recentProp ?? sharedRecent);

  // Follow outside edits (undo, a token picked elsewhere).
  useEffect(() => {
    if (value !== null && value === emitted.current) return;
    const next = parsed ?? (fallback ? parseColor(fallback) : null);
    if (!next) return;
    setHsva((current) => (sameColor(hsvaToRgba(current), next.rgba) ? current : rgbaToHsva(next.rgba, current.h)));
    if (parsed) setFormat(editFormat(parsed.notation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const text = (next: Hsva, fmt = format) => formatColor(hsvaToRgba(alpha ? next : { ...next, a: 1 }), fmt, fmt === format ? notation : {});
  const live = useFrameThrottle<string>((next) => onChange(next));
  const commit = (next: string) => {
    live.flush();
    emitted.current = next;
    onChange(next);
    onCommit?.(next);
    if (recentProp === undefined) pushRecentColor(next);
  };

  /** A drag step: update the picker and emit live. */
  const drag = (next: Hsva) => {
    const fixed = alpha ? next : { ...next, a: 1 };
    setHsva(fixed);
    const out = text(fixed);
    emitted.current = out;
    live.call(out);
  };
  /** A keyboard step or a release: update and commit. */
  const settle = (next: Hsva) => {
    const fixed = alpha ? next : { ...next, a: 1 };
    setHsva(fixed);
    commit(text(fixed));
  };

  /** A color typed into the text field and not committed yet: shown in the picker only. */
  const [typed, setTyped] = useState<Hsva | null>(null);
  /** Why the last text entered went back (not a color), until the next edit. */
  const [refused, setRefused] = useState<string | null>(null);
  const refusedId = useId();
  const previewText = (raw: string) => {
    if (raw !== shownText) setRefused(null);
    const next = raw === shownText ? null : parseColor(withHexHash(raw));
    setTyped(next ? rgbaToHsva(alpha ? next.rgba : { ...next.rgba, a: 1 }, hsva.h) : null);
  };

  const pickText = (raw: string): boolean => {
    setTyped(null);
    const entered = raw.trim();
    if (!entered) return false;
    const hexless = withHexHash(entered);
    const next = parseColor(hexless);
    if (next) {
      setRefused(null);
      setHsva(rgbaToHsva(alpha ? next.rgba : { ...next.rgba, a: 1 }, hsva.h));
      setFormat(editFormat(next.notation));
      commit(alpha || next.rgba.a === 1 ? hexless : formatColor({ ...next.rgba, a: 1 }, editFormat(next.notation), next.notation));
      return true;
    }
    // Other CSS colors (`var(--x)`, `color-mix()`) pass through when the browser reads them.
    if (typeof CSS !== 'undefined' && CSS.supports('color', entered)) {
      setRefused(null);
      commit(entered);
      return true;
    }
    setRefused(colorRevertMessage(shownText));
    return false;
  };

  const pickSwatch = (swatch: { value: string; css?: string }) => {
    const next = parseColor(swatch.value);
    if (next) setHsva(rgbaToHsva(next.rgba, hsva.h));
    commit(swatch.css ?? swatch.value);
  };

  const switchFormat = (next: ColorFormat) => {
    setFormat(next);
    if (value === null || parsed) commit(formatColor(hsvaToRgba(alpha ? hsva : { ...hsva, a: 1 }), next, {}, next === 'oklch' && parsed?.notation.format === 'oklch' ? parsed.oklch : undefined));
  };

  const dropper = typeof window !== 'undefined' && 'EyeDropper' in window ? (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper : null;
  const seen = typed ?? hsva;
  const rgb = hsvaToRgba({ ...seen, a: 1 });
  const solid = formatColor(rgb, 'hex');
  const shownText = value !== null && !parsed ? value : text(hsva);
  const current = value ?? null;

  const groups = useMemo(() => {
    const out = new Map<string, ColorSwatch[]>();
    for (const swatch of swatches ?? []) {
      const key = swatch.group ?? '';
      out.set(key, [...(out.get(key) ?? []), swatch]);
    }
    return [...out.entries()];
  }, [swatches]);

  return (
    <div className={cn('flex w-60 flex-col gap-3', className)}>
      <ColorArea hsva={seen} onDrag={drag} onSettle={settle} />
      <ColorSlider
        label="Hue"
        value={seen.h / 360}
        background="linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%)"
        thumb={`hsl(${seen.h} 100% 50%)`}
        max={360}
        largeStep={10 / 360}
        valueText={`${Math.round(hsva.h)}°, ${hueName(hsva.h)}`}
        onDrag={(t) => drag({ ...hsva, h: Math.min(359.9, t * 360) })}
        onSettle={(t) => settle({ ...hsva, h: Math.min(359.9, t * 360) })}
      />
      {alpha ? (
        <ColorSlider
          label="Opacity"
          value={seen.a}
          background={`linear-gradient(to right, transparent, ${solid}), ${CHECKERBOARD}`}
          thumb={formatColor({ ...rgb, a: seen.a }, 'rgb')}
          valueText={`${Math.round(hsva.a * 100)}% opaque`}
          onDrag={(t) => drag({ ...hsva, a: Math.round(t * 100) / 100 })}
          onSettle={(t) => settle({ ...hsva, a: Math.round(t * 100) / 100 })}
        />
      ) : null}
      <Segmented<ColorFormat> aria-label="Color format" value={parsed || value === null ? format : null} options={FORMAT_OPTIONS} onChange={switchFormat} className="text-[11px]" />
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-7 shrink-0 rounded-control shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
          style={{ background: `linear-gradient(${formatColor(hsvaToRgba(seen), 'rgb')}, ${formatColor(hsvaToRgba(seen), 'rgb')}), ${CHECKERBOARD}` }}
        />
        <CommitInput
          aria-label="Color value"
          aria-invalid={refused ? true : undefined}
          aria-describedby={refused ? refusedId : undefined}
          value={shownText}
          onCommit={pickText}
          onDraftChange={previewText}
          spellCheck={false}
          className="font-mono text-[12px]"
        />
        {dropper ? (
          <button
            type="button"
            aria-label="Pick a color from the screen"
            title="Pick a color from the screen"
            onKeyDown={preventRepeatedActivation}
            onClick={() => {
              void new dropper()
                .open()
                .then((result) => {
                  const picked = parseColor(result.sRGBHex);
                  if (picked) settle(rgbaToHsva({ ...picked.rgba, a: hsva.a }, hsva.h));
                })
                .catch(() => undefined);
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Pipette className="size-4" />
          </button>
        ) : null}
        {onClear ? (
          <button
            type="button"
            aria-label="No color"
            title="No color"
            onKeyDown={preventRepeatedActivation}
            onClick={onClear}
            className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {refused ? (
        <p id={refusedId} role="status" className="-mt-1.5 text-[11px] text-warning">
          {refused}
        </p>
      ) : null}
      {contrastAgainst ? (
        <ContrastBadge
          color={value !== null && !parsed ? value : text(hsva)}
          against={contrastAgainst}
          level={level}
          large={largeText}
          onFix={(fix) => {
            const next = parseColor(fix);
            if (next) setHsva(rgbaToHsva(next.rgba, hsva.h));
            commit(fix);
          }}
        />
      ) : null}
      {groups.map(([group, items]) => (
        <SwatchGrid key={group || '_'} title={group || (groups.length > 1 || recentColors.length ? 'Colors' : undefined)} label={group || 'Swatches'}>
          {items.map((swatch) => (
            <SwatchButton
              key={`${swatch.name}:${swatch.css ?? swatch.value}`}
              name={swatch.name}
              color={swatch.value}
              selected={current !== null && (current === swatch.css || (swatch.css === undefined && sameColor(current, swatch.value)))}
              onPick={() => pickSwatch(swatch)}
            />
          ))}
        </SwatchGrid>
      ))}
      {recentColors.length ? (
        <SwatchGrid title="Recent" label="Recent colors">
          {recentColors.map((color) => (
            <SwatchButton key={color} name={color} color={color} selected={false} onPick={() => pickSwatch({ value: color })} />
          ))}
        </SwatchGrid>
      ) : null}
    </div>
  );
}

/* ------------------------------ area & sliders ----------------------------- */

/** Pointer position inside `element`, 0–1 on both axes. */
function relative(event: PointerEvent<HTMLElement>, element: HTMLElement): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width))),
    y: Math.max(0, Math.min(1, (event.clientY - box.top) / Math.max(1, box.height))),
  };
}

/** Arrow-key step of the area: 1%, Shift 10%. */
const keyStep = (event: KeyboardEvent) => (event.shiftKey ? 0.1 : 0.01);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const THUMB = 'pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.3)]';

/** The saturation (x) / brightness (y) area at the current hue. */
function ColorArea({ hsva, onDrag, onSettle }: { hsva: Hsva; onDrag: (next: Hsva) => void; onSettle: (next: Hsva) => void }) {
  const last = useRef(hsva);
  last.current = hsva;
  const at = (event: PointerEvent<HTMLDivElement>) => {
    const { x, y } = relative(event, event.currentTarget);
    return { ...last.current, s: x, v: 1 - y };
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const d = keyStep(event);
    const moves: Record<string, Partial<Hsva>> = {
      ArrowLeft: { s: hsva.s - d },
      ArrowRight: { s: hsva.s + d },
      ArrowUp: { v: hsva.v + d },
      ArrowDown: { v: hsva.v - d },
      Home: { s: 0 },
      End: { s: 1 },
      PageUp: { v: hsva.v + 0.1 },
      PageDown: { v: hsva.v - 0.1 },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onSettle({ ...hsva, s: clamp01(move.s ?? hsva.s), v: clamp01(move.v ?? hsva.v) });
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsva.s * 100)}
      aria-valuetext={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
      className="relative aspect-[3/2] w-full cursor-crosshair touch-none rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsva.h} 100% 50%)` }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        onDrag(at(event));
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onDrag(at(event));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onSettle(at(event));
      }}
      onKeyDown={onKeyDown}
    >
      <span className={THUMB} style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: formatColor(hsvaToRgba({ ...hsva, a: 1 }), 'hex') }} />
    </div>
  );
}

/**
 * A horizontal 0–1 slider painted with `background` (hue, opacity). It reads
 * as 0–`max` (100 for percents, 360 for degrees); an arrow moves one of
 * those units, Shift + arrow and Page Up/Down move `largeStep`.
 */
function ColorSlider({
  label,
  value,
  max = 100,
  largeStep = 0.1,
  background,
  thumb,
  valueText,
  onDrag,
  onSettle,
}: {
  label: string;
  value: number;
  max?: number;
  largeStep?: number;
  background: string;
  thumb: string;
  valueText: string;
  onDrag: (value: number) => void;
  onSettle: (value: number) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const d = event.shiftKey ? largeStep : 1 / max;
    const moves: Record<string, number> = {
      ArrowLeft: value - d,
      ArrowDown: value - d,
      ArrowRight: value + d,
      ArrowUp: value + d,
      PageDown: value - largeStep,
      PageUp: value + largeStep,
      Home: 0,
      End: 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSettle(clamp01(next));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * max)}
      aria-valuetext={valueText}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ background }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        onDrag(relative(event, event.currentTarget).x);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onDrag(relative(event, event.currentTarget).x);
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onSettle(relative(event, event.currentTarget).x);
      }}
      onKeyDown={onKeyDown}
    >
      <span className={cn(THUMB, 'top-1/2')} style={{ left: `${value * 100}%`, background: `linear-gradient(${thumb}, ${thumb}), ${CHECKERBOARD}` }} />
    </div>
  );
}

/* --------------------------------- swatches -------------------------------- */

/**
 * A titled grid of swatches with one tab stop: arrow keys move between
 * them, Home/End jump to the ends.
 */
function SwatchGrid({ title, label, children }: { title?: string; label: string; children: ReactNode }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-swatch]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const perRow = Math.max(1, Math.round(event.currentTarget.clientWidth / 24));
    const moves: Record<string, number> = { ArrowLeft: at - 1, ArrowRight: at + 1, ArrowUp: at - perRow, ArrowDown: at + perRow, Home: 0, End: buttons.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
    buttons.forEach((button) => (button.tabIndex = button === target ? 0 : -1));
    target?.focus();
  };
  // The first swatch (or the selected one) is the group's tab stop.
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button[data-swatch]')];
    const stop = buttons.find((button) => button.getAttribute('aria-pressed') === 'true') ?? buttons[0];
    buttons.forEach((button) => (button.tabIndex = button === stop ? 0 : -1));
  }, []);
  return (
    <div className="flex flex-col gap-1.5">
      {title ? <div className="text-[11px] font-medium text-fg-subtle">{title}</div> : null}
      <div ref={ref} role="group" aria-label={label} onKeyDown={onKeyDown} className="flex flex-wrap gap-1">
        {children}
      </div>
    </div>
  );
}

function SwatchButton({ name, color, selected, onPick }: { name: string; color: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      data-swatch=""
      title={name}
      aria-label={name}
      aria-pressed={selected}
      onClick={onPick}
      onKeyDown={preventRepeatedActivation}
      className={cn(
        'size-5 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        selected && 'outline-2 outline-offset-1 outline-fg',
      )}
      style={{ background: `linear-gradient(${color}, ${color}), ${CHECKERBOARD}` }}
    />
  );
}

/* --------------------------------- popover -------------------------------- */

/** Props of {@link ColorPicker}. */
export interface ColorPickerProps extends ColorPickerPanelProps {
  /** Accessible name of the trigger, e.g. "Fill". */
  'aria-label': string;
  /**
   * The trigger: `field` (swatch and the value as text, the default),
   * `swatch` (a 20px swatch alone), or your own element.
   */
  trigger?: 'field' | 'swatch' | ReactElement<Record<string, unknown>>;
  /** Text shown in the field while no color is set (default "None"). */
  placeholder?: string;
  /** Several selected things differ. */
  mixed?: boolean;
  disabled?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Class of the trigger. */
  triggerClassName?: string;
}

const MIXED_SWATCH = 'linear-gradient(135deg, #ffffff 50%, #1c1c1a 50%)';

/** What the trigger's swatch paints. */
function swatchPaint(value: string | null, fallback: string | null | undefined, mixed: boolean): string {
  if (mixed) return MIXED_SWATCH;
  const color = value ?? fallback;
  return color ? `linear-gradient(${color}, ${color}), ${CHECKERBOARD}` : CHECKERBOARD;
}

/**
 * A color control: a trigger (a field showing the swatch and value, or a
 * swatch alone) that opens {@link ColorPickerPanel} in a popover.
 */
export function ColorPicker({
  trigger = 'field',
  placeholder = 'None',
  mixed = false,
  disabled,
  side = 'bottom',
  align = 'start',
  open,
  onOpenChange,
  triggerClassName,
  ...panel
}: ColorPickerProps) {
  const { value, fallback, swatches } = panel;
  const label = panel['aria-label'];
  const token = value ? swatches?.find((swatch) => swatch.css === value || (swatch.css === undefined && swatch.value === value)) : undefined;
  const text = mixed ? 'Mixed' : value === null ? placeholder : (token?.name ?? value);
  const alphaText = (() => {
    if (mixed || !value) return null;
    const a = parseColor(value)?.rgba.a;
    return a !== undefined && a < 1 ? `${Math.round(a * 100)}%` : null;
  })();
  const element =
    typeof trigger === 'object' ? (
      trigger
    ) : trigger === 'swatch' ? (
      <button
        type="button"
        aria-label={`${label}: ${text}`}
        title={text}
        className={cn(
          'size-5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-45',
          triggerClassName,
        )}
        style={{ background: swatchPaint(value, fallback, mixed) }}
      />
    ) : (
      <button
        type="button"
        aria-label={`${label}: ${text}`}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-control border border-line bg-surface-2 pl-1 pr-2 text-left text-[13px] text-fg outline-none',
          'focus-visible:border-accent data-[popup-open]:border-accent disabled:opacity-45',
          triggerClassName,
        )}
      >
        <span className="size-5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: swatchPaint(value, fallback, mixed) }} />
        <span className={cn('min-w-0 flex-1 truncate', (value === null || mixed) && 'text-fg-subtle', !token && 'font-mono text-[12px]')}>{text}</span>
        {alphaText ? <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">{alphaText}</span> : null}
      </button>
    );
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <BasePopover.Trigger render={element} disabled={disabled} onKeyDown={preventRepeatedActivation} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={6} collisionPadding={8} className="z-[1000]">
          <BasePopover.Popup aria-label={`${label} color`} className={cn(POPUP_CLASS, 'p-3')}>
            <ColorPickerPanel {...panel} value={mixed ? null : value} />
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
