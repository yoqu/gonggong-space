/**
 * Colors in the properties panel.
 *
 * - {@link ColorField}: one field showing a swatch and what the color is
 *   (a swatch's name, `#RRGGBB`, "Theme default", "None", "Mixed", or the
 *   kind of fill). It opens {@link ColorPanel}.
 * - {@link ColorPanel}: a "Theme" tab listing the deck's colors (the
 *   installed design systems' tokens, else the colors the deck uses most)
 *   and a "Custom" tab with a picker: a saturation / brightness square,
 *   hue and alpha sliders, an eyedropper where the browser has one, and hex
 *   and alpha fields. Fills that may be a gradient or a picture put a Type
 *   switch at the top of the Custom tab.
 * - {@link ContrastBadge}: "Good contrast" / "Poor contrast" under a text
 *   or icon color, the ratio in its tooltip. The fix, "Use a readable
 *   shade", is in the picker.
 *
 * Picking a theme color keeps the panel open; None closes it. Dragging in
 * the picker commits as it goes (callers coalesce those into one undo step).
 */

import { Popover as BasePopover } from '@base-ui/react/popover';
import { Tabs } from '@base-ui/react/tabs';
import { Check, Pipette, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { toRgba, walkNodes, type Rgba, type Run, type Slide, type SlideNode, type StyleMap } from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { colorLabel, formatPicked, hsvaToRgba, rgbaToHsva, sameColor, type Hsva } from '../../lib/colorspace.ts';
import { useDeck } from '../../state/deck.ts';
import { useView } from '../../state/view.ts';
import { useDesignSystems } from '../../services/design-systems.ts';
import { TypeScaleIcon } from './icons.tsx';
import { Button, CommitInput, FIELD, NumberInput, Row, Segmented, TextInput, type Option } from './kit.tsx';

/* -------------------------------------------------------------------------- */
/* Theme colors                                                                */
/* -------------------------------------------------------------------------- */

/** One color of the Theme tab. */
export interface ColorChoice {
  label: string;
  value: string;
}

/** A titled run of choices (untitled when it is the only one). */
export interface ColorGroup {
  title?: string;
  choices: ColorChoice[];
}

/** Most colors the Theme tab offers from the deck itself. */
const USED_MAX = 12;
/** Colors fainter than this are not offered. */
const MIN_ALPHA = 0.2;

const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

/** Counts every color written in `value` into `counts` (keyed `#RRGGBB`). */
function countColors(value: string | undefined, counts: Map<string, number>): void {
  if (!value) return;
  for (const match of value.matchAll(COLOR_RE)) {
    const rgba = toRgba(match[0]);
    if (!rgba || rgba.a < MIN_ALPHA) continue;
    const key = colorLabel(match[0]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

function countStyle(style: StyleMap, counts: Map<string, number>): void {
  for (const value of Object.values(style)) countColors(value, counts);
}

function countRuns(runs: readonly Run[], counts: Map<string, number>): void {
  for (const run of runs) countColors(run.marks?.color, counts);
}

/** Every color a node paints with: its style, its runs, its rows and cells. */
function countNode(node: SlideNode, counts: Map<string, number>): void {
  countStyle(node.style, counts);
  if (node.kind === 'text') countRuns(node.runs, counts);
  if (node.kind === 'list') for (const item of node.items) countRuns(item.runs, counts);
  if (node.kind === 'textbox') {
    for (const block of node.blocks) {
      if (block.kind === 'text') countRuns(block.runs, counts);
      else for (const item of block.items) countRuns(item.runs, counts);
    }
  }
  if (node.kind === 'table') {
    for (const row of node.rows) {
      countStyle(row.style, counts);
      for (const cell of row.cells) {
        countStyle(cell.style, counts);
        countRuns(cell.runs, counts);
      }
    }
  }
}

/** The most used colors of `slides`, as choices labelled `#RRGGBB`. */
function mostUsed(slides: Iterable<Slide>, skip: ReadonlySet<string>): ColorChoice[] {
  const counts = new Map<string, number>();
  for (const slide of slides) {
    countStyle(slide.style, counts);
    walkNodes(slide, (node) => countNode(node, counts));
  }
  return [...counts.entries()]
    .filter(([value]) => !skip.has(value))
    .sort((a, b) => b[1] - a[1])
    .slice(0, USED_MAX)
    .map(([value]) => ({ label: value, value: value.toLowerCase() }));
}

/**
 * The Theme tab's colors. Without design systems: the 12 colors the deck
 * uses most, untitled. With them: the colors of the current slide first
 * ("In this slide"), then each system's tokens under its title.
 */
export function useColorGroups(): ColorGroup[] {
  const revision = useDeck((s) => s.revision);
  const current = useView((s) => s.current);
  const systems = useDesignSystems((s) => s.systems);
  return useMemo(() => {
    const slides = useDeck.getState().slides;
    if (systems.length === 0) {
      const choices = mostUsed(
        Object.values(slides).map((entry) => entry.slide),
        new Set(),
      );
      return choices.length ? [{ choices }] : [];
    }
    const groups: ColorGroup[] = [];
    const tokens = new Set(systems.flatMap((s) => s.colors.map((c) => colorLabel(c.value))));
    const slide = current ? slides[current]?.slide : undefined;
    const here = slide ? mostUsed([slide], tokens) : [];
    if (here.length) groups.push({ title: 'In this slide', choices: here });
    for (const system of systems) {
      if (system.colors.length) groups.push({ title: system.title, choices: system.colors.map((c) => ({ label: c.name, value: c.value })) });
    }
    return groups;
    // Recomputed when the deck changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, current, systems]);
}

/** The choice whose color is `value`, if any. */
function choiceFor(groups: readonly ColorGroup[], value: string | null): ColorChoice | null {
  if (!value) return null;
  for (const group of groups) for (const choice of group.choices) if (sameColor(choice.value, value)) return choice;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Contrast                                                                    */
/* -------------------------------------------------------------------------- */

/** How readable a text or icon color is on what is behind it. */
export interface ContrastInfo {
  ratio: number;
  /** The ratio it needs (4.5 text, 3 large text and icons). */
  target: number;
  /** CSS of the text color and of the ground, for the chip. */
  text: string;
  ground: string;
  /** What the ground is ("slide background", "box fill"). */
  where: string;
  /** The nearest shade that passes, or null when none does. */
  fix: string | null;
}

/** "Good contrast" / "Poor contrast" with a chip in the colors themselves. */
export function ContrastLockup({ info }: { info: ContrastInfo }): ReactNode {
  const good = info.ratio >= info.target;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={`${info.ratio.toFixed(1)}:1 on ${info.where}`}>
      <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: info.ground, color: info.text }}>
        <TypeScaleIcon className="size-3" />
      </span>
      <span className={cn('truncate text-[12px]', good ? 'text-chrome-fg' : 'text-warning')}>{good ? 'Good contrast' : 'Poor contrast'}</span>
    </span>
  );
}

/** The contrast lockup on its own line under a color row. */
export function ContrastBadge({ info }: { info: ContrastInfo | null }): ReactNode {
  if (!info) return null;
  return (
    <div className="flex h-6 items-center pl-[96px] pr-3">
      <ContrastLockup info={info} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Field                                                                       */
/* -------------------------------------------------------------------------- */

const CHECKER = 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px';
const MIXED_SWATCH = 'linear-gradient(135deg, #ffffff 50%, #141413 50%)';

/** The kind switch of a fill (Color / Gradient / Image). */
export interface FillKinds {
  value: string;
  options: Option<string>[];
  onChange: (value: string) => void;
  /** What the Custom tab shows for kinds other than "color". */
  content?: ReactNode;
}

/** Props of {@link ColorField}. */
export interface ColorFieldProps {
  'aria-label': string;
  /** The color set here, or null when none is. */
  value: string | null;
  mixed?: boolean;
  /** The color shown while none is set (the inherited one). */
  effective?: string | null;
  /** Text while none is set ("Theme default", "None"). */
  emptyLabel?: string;
  /** Offer a "None" row (it commits null and closes). */
  allowNone?: boolean;
  /** No alpha slider or field. */
  opaque?: boolean;
  groups: ColorGroup[];
  onCommit: (value: string | null) => void;
  contrast?: ContrastInfo | null;
  /** Shown instead of the color (a gradient or picture fill). */
  preview?: { swatch: string; label: string } | null;
  kinds?: FillKinds;
  disabled?: boolean;
  title?: string;
}

/** A color field that opens the Theme / Custom panel. */
export function ColorField(props: ColorFieldProps): ReactNode {
  const { value, mixed = false, effective, emptyLabel = 'None', groups, preview, disabled, title } = props;
  const [open, setOpen] = useState(false);
  const rgba = value ? toRgba(value) : null;
  const choice = choiceFor(groups, value);
  const text = mixed ? 'Mixed' : preview ? preview.label : value === null ? emptyLabel : (choice?.label ?? colorLabel(value));
  const color = value ?? effective ?? null;
  const swatchBackground = mixed ? MIXED_SWATCH : preview ? preview.swatch : color ? `linear-gradient(${color}, ${color}), ${CHECKER}` : CHECKER;
  const alpha = !mixed && !preview && rgba && rgba.a < 1 ? `${Math.round(rgba.a * 100)}%` : null;
  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      <BasePopover.Trigger
        disabled={disabled}
        title={title}
        aria-label={`${props['aria-label']}: ${text}`}
        className={cn(FIELD, 'flex w-full min-w-0 cursor-default items-center gap-1.5 pl-1 pr-2 text-left disabled:opacity-50 data-[popup-open]:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)]')}
      >
        <span className="size-4 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]" style={{ background: swatchBackground }} />
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {alpha ? <span className="shrink-0 text-[12px] tabular-nums text-chrome-muted">{alpha}</span> : null}
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-[1000]">
          <BasePopover.Popup className="w-64 rounded-[14px] bg-chrome p-4 text-chrome-fg shadow-chrome-popup outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <ColorPanel
              value={mixed || preview ? null : value}
              fallback={effective ?? null}
              groups={groups}
              allowNone={props.allowNone}
              opaque={props.opaque}
              contrast={props.contrast}
              kinds={props.kinds}
              onPick={(next) => {
                props.onCommit(next);
                if (next === null) setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** A labelled color row: {@link ColorField} plus its contrast badge underneath. */
export function ColorRow({ label, onReset, ...field }: ColorFieldProps & { label: string; onReset?: () => void }): ReactNode {
  return (
    <>
      <Row label={label} onReset={onReset}>
        <ColorField {...field} />
      </Row>
      {!field.mixed && !field.preview ? <ContrastBadge info={field.contrast ?? null} /> : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

/** Props of {@link ColorPanel}. */
export interface ColorPanelProps {
  value: string | null;
  /** Where the picker starts while no color is set. */
  fallback?: string | null;
  groups: ColorGroup[];
  allowNone?: boolean;
  opaque?: boolean;
  contrast?: ContrastInfo | null;
  kinds?: FillKinds;
  /** A theme color, a picked color, or null for None. */
  onPick: (value: string | null) => void;
  onClose: () => void;
}

type Source = 'system' | 'custom';

/** The Theme / Custom panel (the body of a color popover). */
export function ColorPanel({ value, fallback, groups, allowNone, opaque, contrast, kinds, onPick, onClose }: ColorPanelProps): ReactNode {
  const hasChoices = groups.some((g) => g.choices.length > 0) || Boolean(allowNone);
  const isColor = !kinds || kinds.value === 'color';
  const [source, setSource] = useState<Source>(hasChoices && isColor ? 'system' : 'custom');
  const close = (
    <button type="button" aria-label="Close" title="Close" onClick={onClose} className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-[8px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:outline-2 focus-visible:outline-chrome-accent">
      <X className="size-4" strokeWidth={1.5} />
    </button>
  );
  const custom = (
    <div className="flex flex-col gap-3">
      {kinds ? (
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[12px] text-chrome-muted">Type</span>
          <Segmented aria-label="Fill type" value={kinds.value} options={kinds.options} onChange={kinds.onChange} />
        </div>
      ) : null}
      {isColor ? <Picker value={value} fallback={fallback ?? null} opaque={opaque} contrast={contrast ?? null} onPick={onPick} /> : kinds?.content}
    </div>
  );

  if (!hasChoices) {
    return (
      <div className="flex flex-col gap-3">
        <div className="-mt-1 flex items-center">
          <span className="text-[13px] font-[520]">Color</span>
          {close}
        </div>
        {custom}
      </div>
    );
  }
  return (
    <Tabs.Root value={source} onValueChange={(next) => setSource(next as Source)} className="flex flex-col gap-3">
      <div className="-mt-1 flex items-center gap-1">
        <Tabs.List aria-label="Source" className="flex items-center gap-1">
          {(['system', 'custom'] as const).map((tab) => (
            <Tabs.Tab
              key={tab}
              value={tab}
              className="h-7 rounded-[8px] px-2.5 text-[13px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg data-[selected]:text-chrome-fg focus-visible:outline-2 focus-visible:outline-chrome-accent data-[selected]:bg-chrome-selected"
            >
              {tab === 'system' ? 'Theme' : 'Custom'}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {close}
      </div>
      <Tabs.Panel value="system" className="outline-none">
        <ThemeList value={value} groups={groups} allowNone={allowNone} onPick={onPick} />
      </Tabs.Panel>
      <Tabs.Panel value="custom" className="outline-none">
        {custom}
      </Tabs.Panel>
    </Tabs.Root>
  );
}

/** The Theme tab: rows of swatch and name, the current one checked. */
function ThemeList({ value, groups, allowNone, onPick }: { value: string | null; groups: ColorGroup[]; allowNone?: boolean; onPick: (value: string | null) => void }): ReactNode {
  const [query, setQuery] = useState('');
  const total = groups.reduce((n, g) => n + g.choices.length, 0);
  const searchable = total > USED_MAX || groups.some((g) => g.title);
  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, choices: q ? g.choices.filter((c) => c.label.toLowerCase().includes(q) || colorLabel(c.value).toLowerCase().includes(q)) : g.choices }))
    .filter((g) => g.choices.length > 0);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-color-row]')];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
  };
  const row = (key: string, label: string, swatch: ReactNode, pressed: boolean, pick: () => void): ReactNode => (
    <button
      key={key}
      type="button"
      data-color-row
      aria-pressed={pressed}
      onClick={pick}
      className={cn('flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-[13px] outline-none hover:bg-chrome-hover focus-visible:bg-chrome-hover', pressed && 'bg-chrome-hover')}
    >
      {swatch}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {pressed ? <Check className="size-4 shrink-0 text-chrome-accent" strokeWidth={2.25} /> : null}
    </button>
  );
  return (
    <div className="-mx-2 flex flex-col gap-1">
      {searchable ? (
        <div className="px-2 pb-1">
          <TextInput aria-label="Search colors" placeholder="Search colors" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto" onKeyDown={onKeyDown}>
        {allowNone && !q ? row('none', 'None', <span className="size-4 shrink-0 rounded-[4px] border border-dashed border-chrome-muted" />, value === null, () => onPick(null)) : null}
        {shown.map((group, i) => (
          <div key={group.title ?? i}>
            {group.title ? <div className="px-2 pb-1 pt-2 text-[11px] font-[520] text-chrome-muted">{group.title}</div> : null}
            {group.choices.map((choice) =>
              row(
                `${group.title ?? ''}:${choice.label}:${choice.value}`,
                choice.label,
                <span className="size-4 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: choice.value }} />,
                sameColor(choice.value, value),
                () => onPick(choice.value),
              ),
            )}
          </div>
        ))}
        {q && shown.length === 0 ? <p className="px-2 py-2 text-[12px] text-chrome-muted">No matches</p> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Picker                                                                      */
/* -------------------------------------------------------------------------- */

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** Calls `fn` at most once a frame with the latest value. */
function useFrameThrottle<T>(fn: (value: T) => void): (value: T) => void {
  const latest = useRef<{ value: T } | null>(null);
  const frame = useRef<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  return (value: T) => {
    latest.current = { value };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (latest.current) fnRef.current(latest.current.value);
    });
  };
}

/** The Custom tab's picker. */
function Picker({ value, fallback, opaque, contrast, onPick }: { value: string | null; fallback: string | null; opaque?: boolean; contrast: ContrastInfo | null; onPick: (value: string) => void }): ReactNode {
  const [hsva, setHsva] = useState<Hsva>(() => rgbaToHsva(toRgba(value ?? fallback ?? '') ?? BLACK));
  const emit = useFrameThrottle(onPick);
  // Follow edits made elsewhere (a theme color, undo) unless they are ours.
  useEffect(() => {
    const rgba = value ? toRgba(value) : null;
    if (rgba && !sameColor(formatPicked(hsvaToRgba(hsva)), value)) setHsva(rgbaToHsva(rgba, hsva.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const change = (next: Hsva): void => {
    const fixed = opaque ? { ...next, a: 1 } : next;
    setHsva(fixed);
    emit(formatPicked(hsvaToRgba(fixed)));
  };
  const rgb = hsvaToRgba({ ...hsva, a: 1 });
  const solid = formatPicked(rgb);
  const hex = solid.toUpperCase();
  const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window;

  return (
    <div className="flex flex-col gap-3">
      <SaturationSquare hsva={hsva} onChange={change} />
      <Track label="Hue" value={hsva.h / 360} background="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" thumb={`hsl(${hsva.h} 100% 50%)`} valueText={`${Math.round(hsva.h)}°`} onChange={(t) => change({ ...hsva, h: t * 360 })} />
      {!opaque ? (
        <Track
          label="Opacity"
          value={hsva.a}
          background={`linear-gradient(to right, transparent, ${solid}), ${CHECKER}`}
          thumb={formatPicked({ ...rgb, a: hsva.a })}
          valueText={`${Math.round(hsva.a * 100)}%`}
          onChange={(t) => change({ ...hsva, a: Math.round(t * 100) / 100 })}
        />
      ) : null}
      <div className="flex items-center gap-1.5">
        {canDrop ? (
          <button
            type="button"
            aria-label="Pick color from screen"
            title="Pick color from screen"
            className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:outline-2 focus-visible:outline-chrome-accent"
            onClick={() => {
              const Dropper = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
              void new Dropper()
                .open()
                .then((result) => {
                  const rgba = toRgba(result.sRGBHex);
                  if (rgba) change(rgbaToHsva({ ...rgba, a: hsva.a }, hsva.h));
                })
                .catch(() => undefined);
            }}
          >
            <Pipette className="size-4" strokeWidth={1.5} />
          </button>
        ) : null}
        <CommitInput
          aria-label="Hex color"
          value={hex}
          className="min-w-0 flex-1 font-mono text-[12px] uppercase"
          onCommit={(text) => {
            const raw = text.trim();
            const rgba = toRgba(/^[0-9a-f]{3,8}$/i.test(raw) ? `#${raw}` : raw);
            if (rgba) change(rgbaToHsva({ ...rgba, a: opaque ? 1 : rgba.a < 1 ? rgba.a : hsva.a }, hsva.h));
          }}
        />
        {!opaque ? (
          <NumberInput
            aria-label="Opacity percent"
            className="w-[64px] shrink-0"
            value={Math.round(hsva.a * 100)}
            unit="%"
            min={0}
            max={100}
            steppers={false}
            onCommit={(v) => v !== null && change({ ...hsva, a: Math.max(0, Math.min(100, v)) / 100 })}
          />
        ) : null}
      </div>
      {contrast ? (
        <div className="flex flex-col gap-2">
          <ContrastLockup info={contrast} />
          {contrast.ratio < contrast.target && contrast.fix ? (
            <Button size="sm" className="self-start" onClick={() => contrast.fix && onPick(contrast.fix)}>
              Use a readable shade
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Position of a pointer inside `el`, 0–1 on both axes. */
function relative(event: PointerEvent<HTMLElement>, el: HTMLElement): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width))),
    y: Math.max(0, Math.min(1, (event.clientY - box.top) / Math.max(1, box.height))),
  };
}

/** Step of an arrow key (Shift: ten times). */
function keyStep(event: KeyboardEvent): number {
  return event.shiftKey ? 0.1 : 0.01;
}

/** The saturation (x) / brightness (y) square in the current hue. */
function SaturationSquare({ hsva, onChange }: { hsva: Hsva; onChange: (next: Hsva) => void }): ReactNode {
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const { x, y } = relative(event, event.currentTarget);
    onChange({ ...hsva, s: x, v: 1 - y });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const d = keyStep(event);
    const next =
      event.key === 'ArrowLeft' ? { s: hsva.s - d } : event.key === 'ArrowRight' ? { s: hsva.s + d } : event.key === 'ArrowUp' ? { v: hsva.v + d } : event.key === 'ArrowDown' ? { v: hsva.v - d } : null;
    if (!next) return;
    event.preventDefault();
    onChange({ ...hsva, s: Math.max(0, Math.min(1, next.s ?? hsva.s)), v: Math.max(0, Math.min(1, next.v ?? hsva.v)) });
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuetext={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
      className="relative aspect-[3/2] w-full cursor-crosshair touch-none rounded-[8px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chrome-accent"
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsva.h} 100% 50%)` }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
      }}
      onKeyDown={onKeyDown}
    >
      <span
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25),0_1px_3px_rgb(0_0_0/0.3)]"
        style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: formatPicked(hsvaToRgba({ ...hsva, a: 1 })) }}
      />
    </div>
  );
}

/** A horizontal 0–1 track (hue, opacity). */
function Track({ label, value, background, thumb, valueText, onChange }: { label: string; value: number; background: string; thumb: string; valueText: string; onChange: (value: number) => void }): ReactNode {
  const move = (event: PointerEvent<HTMLDivElement>): void => onChange(relative(event, event.currentTarget).x);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const d = keyStep(event);
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? value - d
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? value + d
          : event.key === 'PageDown'
            ? value - 0.1
            : event.key === 'PageUp'
              ? value + 0.1
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? 1
                  : null;
    if (next === null) return;
    event.preventDefault();
    onChange(Math.max(0, Math.min(1, next)));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={valueText}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chrome-accent"
      style={{ background, backgroundSize: background.includes('conic') ? 'auto, 8px 8px' : undefined }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
      }}
      onKeyDown={onKeyDown}
    >
      <span
        className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25),0_1px_3px_rgb(0_0_0/0.3)]"
        style={{ left: `${value * 100}%`, background: thumb }}
      />
    </div>
  );
}
