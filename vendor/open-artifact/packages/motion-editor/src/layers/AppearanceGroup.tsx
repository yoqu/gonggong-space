/**
 * Appearance of the picked layer: its fill, an svg shape's fill and stroke, a drawing's colors set all at once, its
 * scale and its corners, each with its own Reset. Shown on a film not made of scenes, or a finished scene.
 */

import { useMemo, type ReactElement, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { ColorPicker, IconButton, NumberInput, Row, Section, SliderInput, type ColorSwatch } from '@open-artifact/ui';
import { SIZE_BOUNDS, scanFilmColors, type RetouchLayer, type RetouchProperty } from '@open-artifact/motion-core';
import type { LayerLook, LayerRow } from '@open-artifact/motion-stage/protocol';
import { useFilm } from '../stores/film.ts';
import { entryCounts, opaqueHexColor, pickedColor, type EntryLook } from './entry.ts';
import { commitLive, previewLayerProperties, rowEntry, setLayerProperties, shownValue, type LayerChange } from './retouch.ts';
import { useLayers } from './store.ts';
import { appearanceRow, collectLayerTints, type LayerTint } from './tints.ts';
import * as words from './words.ts';

/** Re-renders when a change by hand is made, dragged or read again. */
export function useRetouchState(): void {
  useLayers((s) => s.touched);
  useLayers((s) => s.seen);
  useLayers((s) => s.live);
  useFilm((s) => s.records.retouched);
}

/** The colors the film's code writes, as swatches. */
export function useFilmSwatches(): ColorSwatch[] {
  const film = useFilm((s) => s.film);
  return useMemo(() => (film === null ? [] : scanFilmColors(film).map((color) => ({ name: color.hex.toUpperCase(), value: color.hex, group: words.IN_THIS_ANIMATION }))), [film]);
}

export const countsIn = (look: EntryLook, property: RetouchProperty) => (entry: RetouchLayer): boolean =>
  entryCounts(entry, look, property, useLayers.getState().touched);

/** A property of a row is set by hand where it shows: Reset is offered. */
export function isSetByHand(row: LayerRow, look: EntryLook | null, property: RetouchProperty): boolean {
  if (look === null) return false;
  const entry = rowEntry(row, look);
  return entry !== null && entry[property] !== undefined && countsIn(look, property)(entry);
}

export function ResetButton({ what, onReset }: { what: string; onReset: (() => void) | null }): ReactElement {
  return (
    <span className={onReset === null ? 'invisible' : undefined} data-video-reset="">
      <IconButton size="sm" label={words.resetWhat(what)} icon={<RotateCcw className="size-3.5" />} onClick={() => onReset?.()} disabled={onReset === null} />
    </span>
  );
}

export function ColorRow({
  label,
  value,
  mixed = false,
  swatches,
  onLive,
  onCommit,
  onReset,
}: {
  label: string;
  value: string | null;
  mixed?: boolean;
  swatches: readonly ColorSwatch[];
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
  onReset: (() => void) | null;
}): ReactElement {
  return (
    <Row label={label}>
      <div className="min-w-0 flex-1">
        <ColorPicker aria-label={label} value={value} mixed={mixed} placeholder={mixed ? words.MIXED : undefined} alpha={false} swatches={swatches} onChange={onLive} onCommit={onCommit} />
      </div>
      <ResetButton what={label} onReset={onReset} />
    </Row>
  );
}

export function NumberRow({
  label,
  shortLabel,
  value,
  min,
  max,
  step,
  unit,
  placeholder,
  onLive,
  onCommit,
  onReset,
  slider = true,
}: {
  label: string;
  /** Shown in place of `label` where the row's name column is too narrow for it. */
  shortLabel?: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  unit?: string;
  placeholder?: string;
  onLive: (value: number) => void;
  onCommit: (value: number | null) => void;
  onReset: (() => void) | null;
  slider?: boolean;
}): ReactElement {
  return (
    <Row label={shortLabel ?? label}>
      {slider ? (
        <div className="min-w-0 flex-1">
          <SliderInput aria-label={label} value={value ?? min} min={min} max={max} step={step} onChange={onLive} onCommit={(next) => onCommit(next)} />
        </div>
      ) : null}
      <NumberInput
        aria-label={label}
        className={slider ? 'w-[72px] shrink-0' : 'min-w-0 flex-1'}
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        placeholder={placeholder}
        onCommit={onCommit}
      />
      <ResetButton what={label} onReset={onReset} />
    </Row>
  );
}

/** The property controls of one row's own look. */
function ownRows(target: LayerRow, look: LayerLook, swatches: readonly ColorSwatch[], inkAbove: boolean): ReactNode[] {
  const shown = (property: RetouchProperty) => shownValue(target, look, property, countsIn(look, property));
  const entryHas = (property: RetouchProperty): boolean => isSetByHand(target, look, property);
  const change = (property: RetouchProperty, v: string | number | null): LayerChange => ({ row: target, look, property, v });
  const colorValue = (property: RetouchProperty, picked: string): string | null =>
    pickedColor(picked, look[property as keyof LayerLook] as string | null, property === 'svgfill' || property === 'svgstroke');
  const colorRow = (property: 'fill' | 'svgfill' | 'svgstroke' | 'ink', label: string): ReactNode => {
    if (look[property] === null || look[property] === undefined) return null;
    return (
      <ColorRow
        key={property}
        label={label}
        value={opaqueHexColor(shown(property) as string | null) ?? null}
        swatches={swatches}
        onLive={(picked) => {
          const v = colorValue(property, picked);
          if (v !== null) previewLayerProperties([change(property, v)], words.undoLabel(label));
        }}
        onCommit={(picked) => {
          const v = colorValue(property, picked);
          if (v !== null) setLayerProperties([change(property, v)], words.undoLabel(label));
        }}
        onReset={entryHas(property) ? () => setLayerProperties([change(property, null)], words.UNDO_RESET) : null}
      />
    );
  };
  const size = look.size === null ? null : Math.round(((shown('size') as number | null) ?? look.size) * 100);
  const radiusShows = look.radius !== null && look.most >= 2;
  const radius = radiusShows ? Math.min(look.most, Math.round((shown('radius') as number | null) ?? look.radius ?? 0)) : null;
  return [
    colorRow('fill', words.FILL),
    colorRow('svgfill', words.FILL),
    colorRow('svgstroke', look.filled ? words.STROKE : words.COLOR),
    inkAbove ? null : colorRow('ink', words.COLOR),
    size === null ? null : (
      <NumberRow
        key="size"
        label={words.SCALE}
        value={size}
        min={Math.round(SIZE_BOUNDS[0] * 100)}
        max={Math.round(SIZE_BOUNDS[1] * 100)}
        step={1}
        unit="%"
        onLive={(value) => previewLayerProperties([change('size', value / 100)], words.undoLabel(words.SCALE))}
        onCommit={(value) => {
          if (value === null) commitLive();
          else setLayerProperties([change('size', Math.round(value) / 100)], words.undoLabel(words.SCALE));
        }}
        onReset={entryHas('size') ? () => setLayerProperties([change('size', null)], words.UNDO_RESET) : null}
      />
    ),
    radius === null ? null : (
      <NumberRow
        key="radius"
        label={words.RADIUS}
        value={radius}
        min={0}
        max={look.most}
        step={1}
        unit="px"
        onLive={(value) => previewLayerProperties([change('radius', Math.round(value))], words.undoLabel(words.RADIUS))}
        onCommit={(value) => {
          if (value === null) commitLive();
          else setLayerProperties([change('radius', Math.round(value))], words.undoLabel(words.RADIUS));
        }}
        onReset={entryHas('radius') ? () => setLayerProperties([change('radius', null)], words.UNDO_RESET) : null}
      />
    ),
  ];
}

function TintRow({ tint, label, swatches }: { tint: LayerTint; label: string; swatches: readonly ColorSwatch[] }): ReactElement {
  const values = tint.at.map(({ row, key }) => (row.look === null ? null : (shownValue(row, row.look, key, countsIn(row.look, key)) as string | null)));
  const first = opaqueHexColor(values[0]) ?? null;
  const mixed = values.some((value) => (opaqueHexColor(value) ?? null) !== first);
  const changes = (picked: string | null): LayerChange[] =>
    tint.at.flatMap(({ row, key, was }) => {
      if (row.look === null) return [];
      const v = picked === null ? null : pickedColor(picked, was, true);
      return picked !== null && v === null ? [] : [{ row, look: row.look, property: key, v }];
    });
  const changed = values.some((value, index) => value !== tint.at[index]!.was);
  return (
    <ColorRow
      label={label}
      value={mixed ? tint.hue : first}
      mixed={mixed}
      swatches={swatches}
      onLive={(picked) => previewLayerProperties(changes(picked), words.undoLabel(label))}
      onCommit={(picked) => setLayerProperties(changes(picked), words.undoLabel(label))}
      onReset={changed ? () => setLayerProperties(changes(null), words.UNDO_RESET) : null}
    />
  );
}

/** Appearance for the picked layer; null where nothing of its look can be changed. `inkAbove`: text styles show its ink. */
export function AppearanceGroup({ layer, inkAbove }: { layer: LayerRow; inkAbove: boolean }): ReactElement | null {
  useRetouchState();
  const swatches = useFilmSwatches();
  const tints = useMemo(() => collectLayerTints(layer), [layer]);
  const target = appearanceRow(layer);
  const look = target.look !== null && target.look.kin !== null && !/[+*]/.test(target.id) ? target.look : null;
  const own = look === null ? [] : ownRows(target, look, swatches, inkAbove).filter((node) => node !== null);
  if (tints.length === 0 && own.length === 0) return null;
  return (
    <Section title={words.APPEARANCE_TITLE}>
      {tints.map((tint, index) => (
        <TintRow key={tint.hue} tint={tint} label={tints.length === 1 ? words.COLOR : words.colorN(index + 1)} swatches={swatches} />
      ))}
      {own}
    </Section>
  );
}
