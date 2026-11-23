/**
 * Visual editors for CSS effect values: {@link GradientEditor},
 * {@link ShadowEditor} (`box-shadow`) and {@link FilterEditor} (`filter`).
 * Each takes and produces CSS text; a value it cannot represent is shown
 * as text to edit by hand instead of being rewritten.
 */
import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { IconButton } from './button.tsx';
import { cn } from './cn.ts';
import { CHECKERBOARD, ColorPicker, type ColorSwatch } from './color-picker.tsx';
import {
  DEFAULT_SHADOW,
  FILTER_SPECS,
  colorAtPosition,
  defaultGradient,
  formatBoxShadow,
  formatFilter,
  formatGradient,
  newFilter,
  parseBoxShadow,
  parseFilter,
  parseGradient,
  sortStops,
  type FilterAmountKind,
  type FilterFunction,
  type FilterKind,
  type Gradient,
  type GradientStop,
  type ShadowLayer,
} from './effects.ts';
import { CommitInput, Segmented } from './fields.tsx';
import { Menu, MenuItem } from './menu.tsx';
import { ScrubNumberField } from './scrub-number-field.tsx';

/** Props shared by the effect editors. */
export interface EffectEditorProps {
  /** The CSS value (`linear-gradient(…)`, a `box-shadow`, a `filter`). */
  value: string;
  /** Live updates while dragging or scrubbing. */
  onChange: (css: string) => void;
  /** Final values (a release, a typed value, an add or remove). */
  onCommit?: (css: string) => void;
  /** Swatches offered by the color pickers (design tokens). */
  swatches?: readonly ColorSwatch[];
  className?: string;
}

/** Items with stable ids, so React keys and selection survive sorting. */
type WithId<T> = T & { id: number };
let nextId = 1;
const withIds = <T extends object>(items: readonly T[]): WithId<T>[] => items.map((item) => ({ ...item, id: nextId++ }));
const stripIds = <T extends object>(items: readonly WithId<T>[]): T[] => items.map(({ id: _id, ...rest }) => rest as unknown as T);

/**
 * Keeps a parsed model of `value`, re-reading it when it changes from
 * outside (not when it is the echo of this editor's own output).
 */
function useParsedValue<M>(value: string, parse: (css: string) => M | null): [M | null, (next: M, css: string) => void] {
  const [model, setModel] = useState<M | null>(() => parse(value));
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    if (value === emitted.current) return;
    setModel(parse(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return [
    model,
    (next, css) => {
      emitted.current = css;
      setModel(next);
    },
  ];
}

/** The text fallback for a value an editor cannot read. */
function RawValue({ label, value, onCommit, onReset, resetLabel }: { label: string; value: string; onCommit: (css: string) => void; onReset: () => void; resetLabel: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <CommitInput aria-label={label} value={value} onCommit={onCommit} spellCheck={false} className="font-mono text-[12px]" />
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <span className="min-w-0 flex-1">This value can only be edited as text.</span>
        <button type="button" onClick={onReset} className="shrink-0 text-accent outline-none hover:underline focus-visible:outline-2 focus-visible:outline-accent">
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

/** A small caption above a field group. */
function Caption({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium text-fg-subtle">{children}</div>;
}

/* -------------------------------- gradient -------------------------------- */

type StopModel = WithId<GradientStop>;
type GradientModel = Omit<Gradient, 'stops'> & { stops: StopModel[] };

const toGradientModel = (gradient: Gradient | null): GradientModel | null => (gradient ? { ...gradient, stops: withIds(gradient.stops) } : null);
const fromGradientModel = (model: GradientModel): Gradient => ({ ...model, stops: stripIds(model.stops) });

/** Props of {@link GradientEditor}. */
export interface GradientEditorProps extends EffectEditorProps {
  'aria-label'?: string;
}

/**
 * A gradient editor: linear or radial, the angle (linear) or shape
 * (radial), and the stops on a bar. Click the bar to add a stop; drag a
 * handle (or focus it and use the arrow keys, Shift for 10%) to move it;
 * Delete removes the focused stop (two always stay).
 */
export function GradientEditor({ value, onChange, onCommit, swatches, className, ...aria }: GradientEditorProps) {
  const [model, setModel] = useParsedValue(value, (css) => toGradientModel(parseGradient(css)));
  const [selected, setSelected] = useState<number | null>(null);
  const label = aria['aria-label'] ?? 'Gradient';

  const emit = (next: GradientModel, final: boolean) => {
    const css = formatGradient(fromGradientModel(next));
    setModel(next, css);
    onChange(css);
    if (final) onCommit?.(css);
  };

  if (!model) {
    return (
      <div className={className}>
        <RawValue
          label={label}
          value={value}
          resetLabel="Use a gradient"
          onCommit={(css) => {
            onChange(css);
            onCommit?.(css);
          }}
          onReset={() => emit(toGradientModel(defaultGradient())!, true)}
        />
      </div>
    );
  }

  const sorted = sortStops(model.stops) as StopModel[];
  const active = sorted.find((stop) => stop.id === selected) ?? sorted[0]!;
  const update = (patch: Partial<GradientModel>, final = true) => emit({ ...model, ...patch }, final);
  const updateStop = (id: number, patch: Partial<GradientStop>, final = true) =>
    update({ stops: model.stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)) }, final);
  const removeStop = (id: number) => {
    if (model.stops.length <= 2) return;
    update({ stops: model.stops.filter((stop) => stop.id !== id) });
    setSelected(null);
  };
  const addStop = (position: number) => {
    const stop = { id: nextId++, color: colorAtPosition(model.stops, position), position: Math.round(position * 10) / 10 };
    update({ stops: [...model.stops, stop] });
    setSelected(stop.id);
  };

  return (
    <div className={cn('flex flex-col gap-2.5', className)} role="group" aria-label={label}>
      <div className="flex items-center gap-1.5">
        <Segmented<Gradient['type']>
          aria-label="Gradient type"
          value={model.type}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
          ]}
          onChange={(type) => update({ type })}
          className="flex-1"
        />
        {model.type === 'linear' ? (
          <ScrubNumberField
            aria-label="Angle"
            label="∠"
            unit="°"
            value={model.angle}
            min={-360}
            max={720}
            step={1}
            largeStep={15}
            onChange={(angle) => update({ angle: ((angle % 360) + 360) % 360 }, false)}
            onCommit={(angle) => update({ angle: ((angle % 360) + 360) % 360 })}
            className="w-20 shrink-0"
          />
        ) : (
          <Segmented<Gradient['shape']>
            aria-label="Shape"
            value={model.shape}
            options={[
              { value: 'ellipse', label: 'Ellipse' },
              { value: 'circle', label: 'Circle' },
            ]}
            onChange={(shape) => update({ shape })}
            className="w-32 shrink-0"
          />
        )}
      </div>
      <StopBar
        stops={sorted}
        selected={active.id}
        onSelect={setSelected}
        onMove={(id, position, final) => updateStop(id, { position }, final)}
        onAdd={addStop}
        onRemove={removeStop}
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Caption>Stops</Caption>
          <IconButton size="sm" label="Add stop" icon={<Plus className="size-3.5" />} onClick={() => addStop(nextGap(sorted))} />
        </div>
        {sorted.map((stop) => (
          <div
            key={stop.id}
            className={cn('flex items-center gap-1.5 rounded-control px-1 py-0.5', stop.id === active.id && 'bg-hover')}
            onFocusCapture={() => setSelected(stop.id)}
          >
            <ColorPicker
              aria-label={`Stop at ${Math.round(stop.position)}%`}
              trigger="swatch"
              value={stop.color}
              swatches={swatches}
              onChange={(color) => updateStop(stop.id, { color }, false)}
              onCommit={(color) => updateStop(stop.id, { color })}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-muted" title={stop.color}>
              {stop.color}
            </span>
            <ScrubNumberField
              aria-label="Stop position"
              value={stop.position}
              unit="%"
              min={0}
              max={100}
              step={1}
              precision={1}
              onChange={(position) => updateStop(stop.id, { position }, false)}
              onCommit={(position) => updateStop(stop.id, { position })}
              className="w-16 shrink-0"
            />
            <IconButton size="sm" label="Remove stop" icon={<Minus className="size-3.5" />} disabled={model.stops.length <= 2} onClick={() => removeStop(stop.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The middle of the widest gap between stops: where "Add stop" puts one. */
function nextGap(sorted: readonly GradientStop[]): number {
  let best = 50;
  let width = -1;
  const points = [0, ...sorted.map((stop) => stop.position), 100];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i]! - points[i - 1]!;
    if (gap > width) {
      width = gap;
      best = (points[i]! + points[i - 1]!) / 2;
    }
  }
  return best;
}

/** The stop bar: a left-to-right preview with a draggable handle per stop. */
function StopBar({
  stops,
  selected,
  onSelect,
  onMove,
  onAdd,
  onRemove,
}: {
  stops: StopModel[];
  selected: number;
  onSelect: (id: number) => void;
  onMove: (id: number, position: number, final: boolean) => void;
  onAdd: (position: number) => void;
  onRemove: (id: number) => void;
}) {
  const bar = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ id: number; pointerId: number } | null>(null);
  const preview = useMemo(() => `linear-gradient(90deg, ${stops.map((stop) => `${stop.color} ${stop.position}%`).join(', ')}), ${CHECKERBOARD}`, [stops]);
  const positionAt = (clientX: number) => {
    const box = bar.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - box.left) / Math.max(1, box.width))) * 1000) / 10;
  };
  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, stop: StopModel) => {
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, number> = { ArrowLeft: stop.position - step, ArrowDown: stop.position - step, ArrowRight: stop.position + step, ArrowUp: stop.position + step, Home: 0, End: 100 };
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(stop.id);
      return;
    }
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onMove(stop.id, Math.max(0, Math.min(100, next)), true);
  };
  return (
    <div className="px-2">
      <div
        ref={bar}
        className="relative h-6 cursor-copy rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
        style={{ background: preview }}
        title="Click to add a stop"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget || event.button !== 0) return;
          onAdd(positionAt(event.clientX));
        }}
      >
        {stops.map((stop) => (
          <button
            key={stop.id}
            type="button"
            role="slider"
            aria-label="Gradient stop"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stop.position)}
            aria-valuetext={`${stop.color} at ${Math.round(stop.position)}%`}
            className={cn(
              'absolute top-1/2 h-7 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-[3px] border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.3)] outline-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              stop.id === selected && 'shadow-[0_0_0_2px_var(--color-accent),0_1px_3px_rgb(0_0_0/0.3)]',
            )}
            style={{ left: `${stop.position}%`, background: `linear-gradient(${stop.color}, ${stop.color}), ${CHECKERBOARD}` }}
            onFocus={() => onSelect(stop.id)}
            onKeyDown={(event) => onHandleKey(event, stop)}
            onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragging.current = { id: stop.id, pointerId: event.pointerId };
              onSelect(stop.id);
            }}
            onPointerMove={(event) => {
              if (dragging.current?.pointerId !== event.pointerId) return;
              onMove(stop.id, positionAt(event.clientX), false);
            }}
            onPointerUp={(event) => {
              if (dragging.current?.pointerId !== event.pointerId) return;
              dragging.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              onMove(stop.id, positionAt(event.clientX), true);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- shadows -------------------------------- */

type LayerModel = WithId<ShadowLayer>;

/** Props of {@link ShadowEditor}. */
export interface ShadowEditorProps extends EffectEditorProps {
  'aria-label'?: string;
}

/**
 * A `box-shadow` editor: a list of layers (front first), each with color,
 * x, y, blur, spread and inset; layers can be added, removed and moved
 * up or down.
 */
export function ShadowEditor({ value, onChange, onCommit, swatches, className, ...aria }: ShadowEditorProps) {
  const [layers, setLayers] = useParsedValue(value, (css) => {
    const parsed = parseBoxShadow(css);
    return parsed ? withIds(parsed) : null;
  });
  const label = aria['aria-label'] ?? 'Shadows';
  const emit = (next: LayerModel[], final = true) => {
    const css = formatBoxShadow(stripIds(next));
    setLayers(next, css);
    onChange(css);
    if (final) onCommit?.(css);
  };

  if (!layers) {
    return (
      <div className={className}>
        <RawValue
          label={label}
          value={value}
          resetLabel="Start over"
          onCommit={(css) => {
            onChange(css);
            onCommit?.(css);
          }}
          onReset={() => emit(withIds([DEFAULT_SHADOW]))}
        />
      </div>
    );
  }

  const patch = (id: number, change: Partial<ShadowLayer>, final = true) => emit(layers.map((layer) => (layer.id === id ? { ...layer, ...change } : layer)), final);
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers];
    [next[index], next[target]] = [next[target]!, next[index]!];
    emit(next);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)} role="group" aria-label={label}>
      {layers.map((layer, index) => (
        <div
          key={layer.id}
          role="group"
          aria-label={`Shadow ${index + 1}`}
          className="flex flex-col gap-1.5 rounded-control border border-line p-1.5"
          onKeyDown={(event) => {
            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || (event.target as HTMLElement).getAttribute('role') === 'spinbutton') return;
            event.preventDefault();
            move(index, event.key === 'ArrowUp' ? -1 : 1);
          }}
        >
          <div className="flex items-center gap-1.5">
            <ColorPicker
              aria-label={`Shadow ${index + 1} color`}
              trigger="swatch"
              value={layer.color === 'currentcolor' ? null : layer.color}
              placeholder="Text color"
              fallback="#000000"
              swatches={swatches}
              onChange={(color) => patch(layer.id, { color }, false)}
              onCommit={(color) => patch(layer.id, { color })}
              onClear={() => patch(layer.id, { color: 'currentcolor' })}
            />
            <Segmented<'drop' | 'inset'>
              aria-label="Shadow kind"
              value={layer.inset ? 'inset' : 'drop'}
              options={[
                { value: 'drop', label: 'Drop' },
                { value: 'inset', label: 'Inner' },
              ]}
              onChange={(kind) => patch(layer.id, { inset: kind === 'inset' })}
              className="flex-1 text-xs"
            />
            <IconButton size="sm" label="Move up" icon={<ArrowUp className="size-3.5" />} disabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton size="sm" label="Move down" icon={<ArrowDown className="size-3.5" />} disabled={index === layers.length - 1} onClick={() => move(index, 1)} />
            <IconButton size="sm" label="Remove shadow" icon={<Minus className="size-3.5" />} onClick={() => emit(layers.filter((item) => item.id !== layer.id))} />
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(['x', 'y', 'blur', 'spread'] as const).map((key) => (
              <ScrubNumberField
                key={key}
                aria-label={`Shadow ${index + 1} ${key}`}
                label={key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'blur' ? 'B' : 'S'}
                title={key === 'blur' ? 'Blur' : key === 'spread' ? 'Spread' : undefined}
                value={layer[key]}
                min={key === 'blur' ? 0 : undefined}
                onChange={(n) => patch(layer.id, { [key]: n }, false)}
                onCommit={(n) => patch(layer.id, { [key]: n })}
              />
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => emit([...layers, ...withIds([DEFAULT_SHADOW])])}
        className="flex h-7 items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong text-xs text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Plus className="size-3.5" />
        Add shadow
      </button>
    </div>
  );
}

/* --------------------------------- filters -------------------------------- */

type FilterModel = WithId<FilterFunction>;

/** Props of {@link FilterEditor}. */
export interface FilterEditorProps extends EffectEditorProps {
  'aria-label'?: string;
  /** The functions offered by "Add filter" (default: all, drop-shadow last). */
  kinds?: readonly FilterKind[];
}

const ALL_FILTER_KINDS: FilterKind[] = [...(Object.keys(FILTER_SPECS) as FilterAmountKind[]), 'drop-shadow'];

/**
 * A `filter` editor: the chain in order, one row per function (blur,
 * brightness, contrast, grayscale, saturate, hue-rotate, invert, sepia,
 * opacity, drop-shadow), each with its amount; functions can be added and
 * removed.
 */
export function FilterEditor({ value, onChange, onCommit, swatches, className, kinds = ALL_FILTER_KINDS, ...aria }: FilterEditorProps) {
  const [chain, setChain] = useParsedValue(value, (css) => {
    const parsed = parseFilter(css);
    return parsed ? withIds(parsed) : null;
  });
  const label = aria['aria-label'] ?? 'Filters';
  const emit = (next: FilterModel[], final = true) => {
    const css = formatFilter(stripIds(next));
    setChain(next, css);
    onChange(css);
    if (final) onCommit?.(css);
  };

  if (!chain) {
    return (
      <div className={className}>
        <RawValue
          label={label}
          value={value}
          resetLabel="Clear filters"
          onCommit={(css) => {
            onChange(css);
            onCommit?.(css);
          }}
          onReset={() => emit([])}
        />
      </div>
    );
  }

  const replace = (id: number, next: FilterFunction, final = true) => emit(chain.map((fn) => (fn.id === id ? { ...next, id } : fn)), final);
  const present = new Set(chain.map((fn) => fn.kind));
  const addable = kinds.filter((kind) => kind === 'drop-shadow' || !present.has(kind));

  return (
    <div className={cn('flex flex-col gap-1.5', className)} role="group" aria-label={label}>
      {chain.map((fn) => (
        <div key={fn.id} className="flex items-center gap-1.5">
          <span className="w-20 shrink-0 truncate text-xs text-fg-muted">{fn.kind === 'drop-shadow' ? 'Drop shadow' : FILTER_SPECS[fn.kind].label}</span>
          {fn.kind === 'drop-shadow' ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <ColorPicker
                aria-label="Drop shadow color"
                trigger="swatch"
                value={fn.shadow.color === 'currentcolor' ? null : fn.shadow.color}
                fallback="#000000"
                swatches={swatches}
                onChange={(color) => replace(fn.id, { kind: 'drop-shadow', shadow: { ...fn.shadow, color } }, false)}
                onCommit={(color) => replace(fn.id, { kind: 'drop-shadow', shadow: { ...fn.shadow, color } })}
              />
              {(['x', 'y', 'blur'] as const).map((key) => (
                <ScrubNumberField
                  key={key}
                  aria-label={`Drop shadow ${key}`}
                  label={key === 'x' ? 'X' : key === 'y' ? 'Y' : 'B'}
                  value={fn.shadow[key]}
                  min={key === 'blur' ? 0 : undefined}
                  onChange={(n) => replace(fn.id, { kind: 'drop-shadow', shadow: { ...fn.shadow, [key]: n } }, false)}
                  onCommit={(n) => replace(fn.id, { kind: 'drop-shadow', shadow: { ...fn.shadow, [key]: n } })}
                  className="min-w-0 flex-1"
                />
              ))}
            </div>
          ) : (
            <ScrubNumberField
              aria-label={FILTER_SPECS[fn.kind].label}
              label={<span aria-hidden="true">↔</span>}
              value={fn.value}
              unit={FILTER_SPECS[fn.kind].unit === 'deg' ? '°' : FILTER_SPECS[fn.kind].unit}
              min={FILTER_SPECS[fn.kind].min}
              max={FILTER_SPECS[fn.kind].max}
              step={FILTER_SPECS[fn.kind].step}
              onChange={(n) => replace(fn.id, { kind: fn.kind, value: n } as FilterFunction, false)}
              onCommit={(n) => replace(fn.id, { kind: fn.kind, value: n } as FilterFunction)}
              className="min-w-0 flex-1"
            />
          )}
          <IconButton size="sm" label="Remove filter" icon={<Minus className="size-3.5" />} onClick={() => emit(chain.filter((item) => item.id !== fn.id))} />
        </div>
      ))}
      {addable.length ? (
        <Menu
          trigger={
            <button
              type="button"
              className="flex h-7 items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong text-xs text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Plus className="size-3.5" />
              Add filter
            </button>
          }
        >
          {addable.map((kind) => (
            <MenuItem key={kind} onSelect={() => emit([...chain, ...withIds([newFilter(kind)])])}>
              {kind === 'drop-shadow' ? 'Drop shadow' : FILTER_SPECS[kind].label}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </div>
  );
}
