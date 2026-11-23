/**
 * The Advanced section (collapsed by default):
 *
 * - Sizing, for a flow child: how it aligns itself in its group (align and,
 *   in a grid, justify self), how it grows, shrinks and starts (the `flex`
 *   shorthand), and its aspect ratio.
 * - Effects: the filter and background filter (blur, brightness, contrast,
 *   saturation, grayscale, sepia, invert, hue), the transform (move, scale,
 *   rotate, skew) and the blend mode, each summarized on a field that opens
 *   its editor.
 * - CSS: every declaration of the selection as an editable row, and a row
 *   to add any property the slide subset supports (checked by the
 *   compiler's property table).
 */

import { Plus, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  CSS_PROPERTIES,
  FILTER_FUNCTIONS,
  formatFilters,
  formatTransform,
  isPinned,
  parentAt,
  parseFilters,
  parseTransform,
  type CssProperty,
  type FilterFunction,
  type Filters,
  type SlideNode,
  type Transform,
} from '@open-artifact/slides-core';
import { CommitInput, IconButton, NumberInput, PanelField, Row, Section, SelectInput } from './kit.tsx';
import { CssField, commitCss, patchTarget, sharedStyle, type Target } from './shared.tsx';

/** A subsection title inside Advanced. */
function Subsection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="px-4 pb-1 pt-2 text-[12px] font-[520] text-chrome-secondary">{title}</div>
      {children}
    </div>
  );
}

/** Every Advanced subsection the selection has. */
export function AdvancedSection({ target }: { target: Target }): ReactNode {
  return (
    <Section title="Advanced" collapsible>
      <SizingRows target={target} />
      <EffectRows target={target} />
      <CssRows target={target} />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Sizing                                                                      */
/* -------------------------------------------------------------------------- */

const SELF_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Stretch' },
] as const;

/** grow, shrink and basis of a flow child, from `flex` or its longhands. */
interface Flex {
  grow: number;
  shrink: number;
  /** `auto`, `0%` or a px length. */
  basis: string;
}

function flexOf(node: SlideNode): Flex {
  const flex = node.style.flex?.trim();
  if (flex === 'none') return { grow: 0, shrink: 0, basis: 'auto' };
  if (flex === 'auto') return { grow: 1, shrink: 1, basis: 'auto' };
  if (flex) {
    const [a, b, c] = flex.split(/\s+/);
    const second = b !== undefined && /^[\d.]+$/.test(b);
    return { grow: Number(a) || 0, shrink: second ? Number(b) : 1, basis: (second ? c : b) ?? '0%' };
  }
  return { grow: Number(node.style['flex-grow'] ?? 0), shrink: Number(node.style['flex-shrink'] ?? 1), basis: node.style['flex-basis'] ?? 'auto' };
}

/** Writes `flex` as one shorthand (none at all when it is the default). */
function writeFlex(target: Target, label: string, fn: (flex: Flex) => Flex): void {
  patchTarget(target, label, (node) => {
    if (!node) return {};
    const next = fn(flexOf(node));
    const neutral = next.grow === 0 && next.shrink === 1 && next.basis === 'auto';
    return { flex: neutral ? undefined : `${next.grow} ${next.shrink} ${next.basis}`, 'flex-grow': undefined, 'flex-shrink': undefined, 'flex-basis': undefined };
  });
}

/** How a flow child sits in its group. */
function SizingRows({ target }: { target: Target }): ReactNode {
  if (target.nodes.length === 0 || target.nodes.some((n) => isPinned(n) || n.kind === 'connector')) return null;
  const node = target.nodes[0]!;
  const path = target.paths[0]!;
  const parentStyle = (path.length > 1 ? parentAt(target.slide, path)?.style : target.slide.style) ?? {};
  const grid = parentStyle.display === 'grid';
  const alignSelf = sharedStyle(target, 'align-self');
  const justifySelf = sharedStyle(target, 'justify-self');
  const flex = flexOf(node);
  const basisPx = /^([\d.]+)px$/.exec(flex.basis);
  const selfValue = (shared: { value: string | undefined; mixed: boolean }): string | null => (shared.mixed ? null : (shared.value?.replace(/^flex-/, '') ?? 'auto'));
  return (
    <Subsection title="Sizing">
      <Row label="Align self">
        <SelectInput aria-label="Align self" value={selfValue(alignSelf)} placeholder="Mixed" options={SELF_OPTIONS.map((o) => ({ ...o }))} onChange={(v) => commitCss(target, 'align-self', v === 'auto' ? '' : v, 'Align self')} />
      </Row>
      {grid ? (
        <Row label="Justify self">
          <SelectInput aria-label="Justify self" value={selfValue(justifySelf)} placeholder="Mixed" options={SELF_OPTIONS.map((o) => ({ ...o }))} onChange={(v) => commitCss(target, 'justify-self', v === 'auto' ? '' : v, 'Justify self')} />
        </Row>
      ) : (
        <>
          <Row label="Grow" tip="How much of the group's spare room this child takes">
            <NumberInput aria-label="Grow" value={flex.grow} min={0} max={1000} onCommit={(v) => writeFlex(target, 'Grow', (f) => ({ ...f, grow: v ?? 0 }))} />
          </Row>
          <Row label="Shrink" tip="How much this child gives up when the group runs out of room">
            <NumberInput aria-label="Shrink" value={flex.shrink} min={0} max={1000} onCommit={(v) => writeFlex(target, 'Shrink', (f) => ({ ...f, shrink: v ?? 1 }))} />
          </Row>
          <Row label="Basis" tip="The size this child starts from before growing or shrinking">
            <NumberInput aria-label="Basis" value={basisPx ? Number(basisPx[1]) : null} placeholder={flex.basis === '0%' ? '0' : 'Auto'} unit="px" min={0} max={4096} step={8} onCommit={(v) => writeFlex(target, 'Basis', (f) => ({ ...f, basis: v === null ? 'auto' : `${v}px` }))} />
          </Row>
        </>
      )}
      <Row label="Aspect">
        <CssField target={target} property="aspect-ratio" label="Aspect ratio" placeholder="Auto" />
      </Row>
    </Subsection>
  );
}

/* -------------------------------------------------------------------------- */
/* Effects                                                                     */
/* -------------------------------------------------------------------------- */

const FILTER_LABELS: Record<FilterFunction, string> = {
  blur: 'Blur',
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturate: 'Saturate',
  grayscale: 'Grayscale',
  sepia: 'Sepia',
  invert: 'Invert',
  'hue-rotate': 'Hue',
};

/** Amounts with no effect (a field at this value removes the function). */
const FILTER_NEUTRAL: Record<FilterFunction, number> = { blur: 0, brightness: 1, contrast: 1, saturate: 1, grayscale: 0, sepia: 0, invert: 0, 'hue-rotate': 0 };

const FILTER_KEYS = Object.keys(FILTER_FUNCTIONS) as FilterFunction[];

/** A filter amount as the field shows it: px, degrees, or a percentage of a ratio. */
function shownAmount(fn: FilterFunction, n: number): number {
  return FILTER_FUNCTIONS[fn].unit === '' ? Math.round(n * 100) : n;
}

function unitOf(fn: FilterFunction): string {
  const unit = FILTER_FUNCTIONS[fn].unit;
  return unit === '' ? '%' : unit === 'deg' ? '°' : unit;
}

/** "Blur 4px · Brightness 120%", or "None". */
function filterSummary(filters: Filters): string {
  const parts = FILTER_KEYS.filter((fn) => filters[fn] !== undefined).map((fn) => `${FILTER_LABELS[fn]} ${shownAmount(fn, filters[fn]!)}${unitOf(fn)}`);
  return parts.length ? parts.join(' · ') : 'None';
}

const BLEND_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
] as const;

const FILTER_KINDS = new Set(['box', 'text', 'list', 'textbox', 'image', 'shape']);

/** Filter, background filter, transform and blend mode. */
function EffectRows({ target }: { target: Target }): ReactNode {
  if (target.nodes.length === 0) return null;
  const filterable = target.nodes.every((n) => FILTER_KINDS.has(n.kind) && n.kind !== 'rule');
  // A shape turns only (Size › Rotation); connectors don't transform.
  const transformable = target.nodes.every((n) => n.kind !== 'connector' && n.kind !== 'shape');
  if (!filterable && !transformable) return null;
  const blend = sharedStyle(target, 'mix-blend-mode');
  return (
    <Subsection title="Effects">
      {filterable ? <FilterRow target={target} property="filter" label="Filter" /> : null}
      {filterable ? <FilterRow target={target} property="backdrop-filter" label="Backdrop" /> : null}
      {transformable ? <TransformRow target={target} /> : null}
      {filterable ? (
        <Row label="Blend">
          <SelectInput aria-label="Blend mode" value={blend.mixed ? null : (blend.value ?? 'default')} placeholder="Mixed" options={BLEND_OPTIONS.map((o) => ({ ...o }))} onChange={(v) => commitCss(target, 'mix-blend-mode', v === 'default' ? '' : v, 'Blend mode')} />
        </Row>
      ) : null}
    </Subsection>
  );
}

/** A filter list as a field; its panel has one amount per function. */
function FilterRow({ target, property, label }: { target: Target; property: 'filter' | 'backdrop-filter'; label: string }): ReactNode {
  const shared = sharedStyle(target, property);
  const parsed = shared.value && !shared.mixed ? parseFilters(shared.value) : null;
  const filters: Filters = parsed?.ok ? parsed.value : {};
  const title = property === 'filter' ? 'Filter' : 'Background filter';
  const set = (fn: FilterFunction, shown: number | null): void => {
    const next: Filters = { ...filters };
    const amount = shown === null ? null : FILTER_FUNCTIONS[fn].unit === '' ? shown / 100 : shown;
    if (amount === null || amount === FILTER_NEUTRAL[fn]) delete next[fn];
    else next[fn] = amount;
    commitCss(target, property, formatFilters(next), title, `${property}-${fn}`);
  };
  return (
    <Row label={label} onReset={shared.value ? () => commitCss(target, property, '', title) : undefined} resetLabel={`Remove ${title.toLowerCase()}`}>
      <PanelField title={title} text={shared.mixed ? 'Mixed' : filterSummary(filters)}>
        {FILTER_KEYS.map((fn) => {
          const spec = FILTER_FUNCTIONS[fn];
          const ratio = spec.unit === '' ? 100 : 1;
          return (
            <Row key={fn} label={FILTER_LABELS[fn]}>
              <NumberInput
                aria-label={`${title} ${FILTER_LABELS[fn].toLowerCase()}`}
                value={filters[fn] === undefined ? null : shownAmount(fn, filters[fn]!)}
                placeholder={String(shownAmount(fn, FILTER_NEUTRAL[fn]))}
                unit={unitOf(fn)}
                min={spec.min * ratio}
                max={spec.max * ratio}
                step={fn === 'blur' ? 0.5 : 1}
                onCommit={(v) => set(fn, v)}
              />
            </Row>
          );
        })}
      </PanelField>
    </Row>
  );
}

/** "Move 10, 0 · Rotate 15°", or "None". */
function transformSummary(t: Transform): string {
  const parts: string[] = [];
  if (t.translateX !== undefined || t.translateY !== undefined) parts.push(`Move ${t.translateX ?? 0}, ${t.translateY ?? 0}`);
  if (t.scale !== undefined) parts.push(`Scale ${Math.round(t.scale * 100)}%`);
  if (t.rotate !== undefined) parts.push(`Rotate ${t.rotate}°`);
  if (t.skewX !== undefined || t.skewY !== undefined) parts.push(`Skew ${t.skewX ?? 0}°, ${t.skewY ?? 0}°`);
  return parts.length ? parts.join(' · ') : 'None';
}

/** The transform as a field; its panel moves, scales, rotates and skews. */
function TransformRow({ target }: { target: Target }): ReactNode {
  const shared = sharedStyle(target, 'transform');
  const parsed = shared.value && !shared.mixed ? parseTransform(shared.value) : null;
  const transform: Transform = parsed?.ok ? parsed.value : {};
  const set = (patch: Partial<Transform>): void => {
    const next: Transform = { ...transform, ...patch };
    for (const key of Object.keys(next) as Array<keyof Transform>) {
      const neutral = key === 'scale' ? 1 : 0;
      if (next[key] === undefined || next[key] === neutral) delete next[key];
    }
    commitCss(target, 'transform', formatTransform(next), 'Transform', 'transform');
  };
  const px = (v: number | '-50%' | undefined): number | null => (typeof v === 'number' ? v : null);
  return (
    <Row label="Transform" onReset={shared.value ? () => commitCss(target, 'transform', '', 'Transform') : undefined} resetLabel="Remove transform">
      <PanelField title="Transform" text={shared.mixed ? 'Mixed' : transformSummary(transform)}>
        <Row label="Move">
          <NumberInput aria-label="Move x" label="X" value={px(transform.translateX)} placeholder={transform.translateX === '-50%' ? '−50%' : '0'} steppers={false} min={-4000} max={4000} onCommit={(v) => set({ translateX: v ?? 0 })} />
          <NumberInput aria-label="Move y" label="Y" value={px(transform.translateY)} placeholder={transform.translateY === '-50%' ? '−50%' : '0'} steppers={false} min={-4000} max={4000} onCommit={(v) => set({ translateY: v ?? 0 })} />
        </Row>
        <Row label="Scale">
          <NumberInput aria-label="Scale" value={transform.scale === undefined ? null : Math.round(transform.scale * 100)} placeholder="100" unit="%" min={50} max={200} onCommit={(v) => set({ scale: (v ?? 100) / 100 })} />
        </Row>
        <Row label="Rotate">
          <NumberInput aria-label="Rotate" value={transform.rotate ?? null} placeholder="0" unit="°" min={-360} max={360} onCommit={(v) => set({ rotate: v ?? 0 })} />
        </Row>
        <Row label="Skew">
          <NumberInput aria-label="Skew x" label="X" value={transform.skewX ?? null} placeholder="0" unit="°" steppers={false} min={-60} max={60} onCommit={(v) => set({ skewX: v ?? 0 })} />
          <NumberInput aria-label="Skew y" label="Y" value={transform.skewY ?? null} placeholder="0" unit="°" steppers={false} min={-60} max={60} onCommit={(v) => set({ skewY: v ?? 0 })} />
        </Row>
      </PanelField>
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                         */
/* -------------------------------------------------------------------------- */

/** Every declaration of the selection, plus "add property". */
function CssRows({ target }: { target: Target }): ReactNode {
  const [adding, setAdding] = useState<CssProperty | null>(null);
  const declared = useMemo(() => {
    const styles = target.nodes.length ? target.nodes.map((n) => n.style) : [target.slide.style];
    const names = new Set<CssProperty>();
    for (const style of styles) for (const key of Object.keys(style) as CssProperty[]) names.add(key);
    return CSS_PROPERTIES.filter((p) => names.has(p));
  }, [target]);
  const available = CSS_PROPERTIES.filter((p) => !declared.includes(p));

  return (
    <Subsection title="CSS">
      {declared.length === 0 ? <p className="px-4 text-[12px] text-chrome-muted">No declarations.</p> : null}
      <div className="flex flex-col gap-1 px-4">
        {declared.map((property) => (
          <div key={property} className="flex min-w-0 items-center gap-1">
            <span className="w-28 shrink-0 truncate font-mono text-[11px] text-chrome-muted" title={property}>
              {property}
            </span>
            <CssField target={target} property={property} />
            <IconButton label={`Remove ${property}`} icon={<X className="size-3" />} onClick={() => commitCss(target, property, '', `Remove ${property}`)} />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-1 px-4 pt-2">
        <div className="w-28 shrink-0">
          <SelectInput<CssProperty> aria-label="Property to add" value={adding} placeholder="Add…" options={available.map((p) => ({ value: p, label: p }))} onChange={setAdding} />
        </div>
        {adding ? (
          <CommitInput
            autoFocus
            aria-label={`${adding} value`}
            className="min-w-0 flex-1 font-mono text-xs"
            value=""
            placeholder="value"
            onCommit={(value) => {
              if (value.trim() && commitCss(target, adding, value, adding)) setAdding(null);
            }}
          />
        ) : (
          <Plus className="size-3.5 text-chrome-muted" />
        )}
      </div>
    </Subsection>
  );
}
