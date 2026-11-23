/**
 * Geometry and layout sections of the properties panel.
 *
 * - Size: for pinned elements their box, position, rotation and alignment
 *   to the slide (or to each other); for flow children each dimension's
 *   size and how it is sized (Hug / Fixed / Fill), a grid child's spans,
 *   the min / max limits "+" adds, and the margin. Grow, shrink, basis, the aspect
 *   ratio and self-alignment are in Advanced.
 * - Containers (a `<div>` or the slide's flow root): Stack, Grid or Layered,
 *   with direction and wrapping, justify / align / distribute, gap and
 *   padding (one value or per side).
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowRight,
  CornerDownLeft,
  Minus,
  Plus,
} from 'lucide-react';
import {
  formatTracks,
  isPinned,
  nodeAt,
  paddingSides,
  parentAt,
  parseTracks,
  pinnedRectOf,
  rotationOf,
  setNodeRect,
  setRotation,
  updateNodeAt,
  type NodePath,
  type Slide,
  type SlideNode,
  type StyleMap,
  type StylePatch,
  type Track,
} from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { ALT, ChromeMenu, ChromeMenuItem } from '@open-artifact/editor-kit/react';
import { IconButton, Note, NumberInput, QuadRow, Row, Section, Segmented, SelectInput, type Quad } from './kit.tsx';
import { ALIGN_KEYS, alignSelection, changeCurrent } from '../../services/commands.ts';
import { useDeck } from '../../state/deck.ts';
import { useView } from '../../state/view.ts';
import { CssField, commitCss, patchTarget, pxOf, sharedStyle, type Target } from './shared.tsx';

/* -------------------------------------------------------------------------- */
/* Pinned geometry                                                             */
/* -------------------------------------------------------------------------- */

/** Position, size and rotation of pinned elements, plus alignment buttons. */
function PinnedSize({ target }: { target: Target }): ReactNode {
  const single = target.nodes.length === 1 ? target.nodes[0]! : null;
  const path = target.paths[0]!;
  const rect = single ? pinnedRectOf(single) : null;

  const setRect = (patch: Partial<{ x: number; y: number; w: number; h: number }>): void => {
    if (!rect) return;
    changeCurrent('Move', (slide) => setNodeRect(slide, path, { ...rect, ...patch }));
  };
  const align = (
    [
      ['left', 'Align left', AlignStartVertical],
      ['center', 'Align centers', AlignCenterVertical],
      ['right', 'Align right', AlignEndVertical],
      ['top', 'Align top', AlignStartHorizontal],
      ['middle', 'Align middles', AlignCenterHorizontal],
      ['bottom', 'Align bottom', AlignEndHorizontal],
    ] as const
  ).map(([edge, label, Icon]) => <IconButton key={edge} size="sm" label={`${target.nodes.length > 1 ? label : `${label} to slide`} (${ALT}${ALIGN_KEYS[edge]})`} icon={<Icon className="size-3.5" />} onClick={() => alignSelection(edge)} />);

  return (
    <Section title="Size">
      {rect && single ? (
        <>
          <Row label="Width">
            <NumberInput aria-label="Width" value={rect.w} min={1} unit="px" onCommit={(v) => v !== null && setRect({ w: v })} />
          </Row>
          <Row label="Height">
            <NumberInput aria-label="Height" value={rect.h} min={1} unit="px" onCommit={(v) => v !== null && setRect({ h: v })} />
          </Row>
          <Row label="Position">
            <NumberInput aria-label="X" label="X" value={rect.x} onCommit={(v) => v !== null && setRect({ x: v })} />
            <NumberInput aria-label="Y" label="Y" value={rect.y} onCommit={(v) => v !== null && setRect({ y: v })} />
          </Row>
          <Row label="Rotation">
            <NumberInput
              aria-label="Rotation"
              value={rotationOf(single)}
              unit="°"
              min={-180}
              max={180}
              onCommit={(v) => changeCurrent('Rotate', (slide) => setRotation(slide, path, v ?? 0))}
            />
          </Row>
        </>
      ) : null}
      <Row label="Align">
        <div className="flex flex-wrap items-center gap-0.5">{align}</div>
      </Row>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Flow children                                                               */
/* -------------------------------------------------------------------------- */

type SizeMode = 'hug' | 'fixed' | 'fill';
type Dimension = 'w' | 'h';

/** How the parent lays out its children. */
interface ParentLayout {
  kind: 'stack' | 'grid';
  /** Stack direction. */
  row: boolean;
  /** The parent's align-items (stretch by default). */
  alignItems: string;
}

function parentLayout(slide: Slide, path: NodePath): ParentLayout {
  const style: StyleMap = (path.length > 1 ? parentAt(slide, path)?.style : slide.style) ?? {};
  return {
    kind: style.display === 'grid' ? 'grid' : 'stack',
    row: style['flex-direction'] === 'row' || style['flex-direction'] === 'row-reverse',
    alignItems: style['align-items'] ?? 'stretch',
  };
}

/** True when `dimension` runs along the parent's main axis. */
function isMain(parent: ParentLayout, dimension: Dimension): boolean {
  return parent.kind === 'stack' && parent.row === (dimension === 'w');
}

/** The self-alignment property that sizes a cross-axis / cell dimension. */
function selfKey(parent: ParentLayout, dimension: Dimension): 'align-self' | 'justify-self' {
  return parent.kind === 'grid' && dimension === 'w' ? 'justify-self' : 'align-self';
}

/** Reads the size mode of a flow child along one dimension. */
function sizeModeOf(node: SlideNode, parent: ParentLayout, dimension: Dimension): SizeMode {
  const size = node.style[dimension === 'w' ? 'width' : 'height'];
  if (size && size !== 'auto' && size !== '100%') return 'fixed';
  if (size === '100%') return 'fill';
  if (isMain(parent, dimension)) {
    const flex = node.style.flex ?? '';
    return /^[1-9]/.test(flex) || Number(node.style['flex-grow'] ?? 0) > 0 ? 'fill' : 'hug';
  }
  const self = node.style[selfKey(parent, dimension)];
  if (self) return self === 'stretch' ? 'fill' : 'hug';
  // No self-alignment: the parent's align-items decides (grid cells stretch too).
  return parent.alignItems === 'stretch' || parent.alignItems === 'normal' ? 'fill' : 'hug';
}

/** The style patch that gives a flow child `mode` along `dimension`. */
function sizeModePatch(node: SlideNode, parent: ParentLayout, dimension: Dimension, mode: SizeMode, measured: number): StylePatch {
  const sizeKey = dimension === 'w' ? 'width' : 'height';
  if (isMain(parent, dimension)) {
    if (mode === 'fill') return { [sizeKey]: undefined, flex: '1', 'flex-grow': undefined, 'flex-basis': undefined };
    if (mode === 'fixed') return { [sizeKey]: `${Math.round(measured)}px`, flex: 'none', 'flex-grow': undefined };
    return { [sizeKey]: undefined, flex: undefined, 'flex-grow': undefined, 'flex-basis': undefined };
  }
  const key = selfKey(parent, dimension);
  if (mode === 'fill') return { [sizeKey]: undefined, [key]: 'stretch' };
  if (mode === 'fixed') return { [sizeKey]: `${Math.round(measured)}px`, [key]: node.style[key] === 'stretch' ? undefined : node.style[key] };
  return { [sizeKey]: undefined, [key]: 'start' };
}

/** A grid child's `span N` (1 when not spanning). */
function spanOf(value: string | undefined): number {
  const m = value ? /span\s+(\d+)/.exec(value) : null;
  return m ? Number(m[1]) : 1;
}

/** The element at `path` on the stage. */
function stageElement(path: NodePath): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-open-artifact-stage] [data-open-artifact-path="${path.join('.')}"]`);
}

/**
 * The layout size of a stage element in slide px. HTML elements report it
 * directly; an SVG element (a connector) is measured on screen and scaled
 * back by its nearest HTML ancestor's zoom.
 */
function boxSize(el: Element): { w: number; h: number } {
  if (el instanceof HTMLElement) return { w: el.offsetWidth, h: el.offsetHeight };
  const rect = el.getBoundingClientRect();
  let host = el.parentElement;
  while (host && host.offsetWidth === 0) host = host.parentElement;
  const zoom = host ? host.getBoundingClientRect().width / host.offsetWidth || 1 : 1;
  return { w: Math.round(rect.width / zoom), h: Math.round(rect.height / zoom) };
}

/** The measured size of the element at `path` on the stage, in slide px. */
function measuredSize(path: NodePath): { w: number; h: number } {
  const el = stageElement(path);
  return el ? boxSize(el) : { w: 240, h: 120 };
}

/** The live size of the element at `path` on the stage (null until it shows). */
function useMeasured(path: NodePath | null): { w: number; h: number } | null {
  const key = path ? path.join('.') : null;
  const revision = useDeck((s) => s.revision);
  // Starting or ending a text edit swaps the element for the editor (or
  // back), so the observer has to move to the new one.
  const editing = useView((s) => s.textEdit !== null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let observer: ResizeObserver | null = null;
    // Wait a frame so the stage has rendered this revision.
    const frame = requestAnimationFrame(() => {
      const el = stageElement(key.split('.').map(Number));
      if (!el) return setSize(null);
      const read = (): void => {
        const { w, h } = boxSize(el);
        // A hidden element (the text editor covers it while typing) measures
        // 0 × 0: keep the last real size rather than show zeros.
        if (w === 0 && h === 0) return;
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      };
      read();
      observer = new ResizeObserver(read);
      observer.observe(el);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [key, revision, editing]);
  return size;
}

const SIZE_TIP = (label: string): string => `${label}: Hug sizes to the content, Fixed is an exact size, Fill takes the space the group gives it.`;

/** The limits "+" can add to Size. */
type Limit = 'min-width' | 'max-width' | 'min-height' | 'max-height';
const LIMITS: ReadonlyArray<{ key: Limit; label: string }> = [
  { key: 'min-width', label: 'Min width' },
  { key: 'max-width', label: 'Max width' },
  { key: 'min-height', label: 'Min height' },
  { key: 'max-height', label: 'Max height' },
];

/**
 * Size of the selection. Pinned elements get their box, position, rotation
 * and alignment; flow children get each dimension as a number (the fixed
 * size, or the measured one) and how it is sized (Hug / Fixed / Fill), the
 * grid spans of a grid child, and the limits "+" adds.
 */
export function SizeSection({ target }: { target: Target }): ReactNode {
  const selectionKey = target.paths.map((p) => p.join('.')).join('|');
  const [revealed, setRevealed] = useState<ReadonlySet<Limit>>(new Set());
  useEffect(() => setRevealed(new Set()), [selectionKey]);
  const measured = useMeasured(target.nodes.length === 1 ? target.paths[0]! : null);
  if (target.nodes.length === 0) return null;
  if (target.nodes.every((n) => isPinned(n) && n.kind !== 'connector')) return <PinnedSize target={target} />;
  if (target.nodes.some((n) => isPinned(n))) return null;
  const path = target.paths[0]!;
  const node = target.nodes[0]!;
  const parent = parentLayout(target.slide, path);
  const shown = (key: Limit): boolean => revealed.has(key) || target.nodes.some((n) => n.style[key] !== undefined);

  const setMode = (dimension: Dimension, mode: SizeMode, px?: number): void => {
    changeCurrent('Size', (slide) => {
      let next = slide;
      for (const p of target.paths) {
        const n = nodeAt(next, p);
        if (!n) continue;
        const size = measuredSize(p);
        const patch = sizeModePatch(n, parentLayout(next, p), dimension, mode, px ?? (dimension === 'w' ? size.w : size.h));
        next = updateNodeAt(next, p, (m) => ({ ...m, style: applyPatch(m.style, patch) }) as SlideNode);
      }
      return next;
    });
  };

  const dimensionRow = (dimension: Dimension): ReactNode => {
    const mode = sizeModeOf(node, parent, dimension);
    const property = dimension === 'w' ? 'width' : 'height';
    const label = dimension === 'w' ? 'Width' : 'Height';
    const fixed = mode === 'fixed' ? pxOf(node.style[property]) : null;
    const value = fixed ?? (measured ? Math.round(dimension === 'w' ? measured.w : measured.h) : null);
    return (
      <Row label={label} tip={SIZE_TIP(label)}>
        <NumberInput
          aria-label={label}
          value={target.nodes.length === 1 ? value : null}
          placeholder={target.nodes.length === 1 ? 'Auto' : 'Mixed'}
          min={1}
          max={4096}
          step={8}
          onCommit={(v) => v !== null && setMode(dimension, 'fixed', v)}
        />
        <SelectInput<SizeMode>
          aria-label={`${label} sizing`}
          className="w-[76px] shrink-0"
          value={target.nodes.every((n, i) => sizeModeOf(n, parentLayout(target.slide, target.paths[i]!), dimension) === mode) ? mode : null}
          placeholder="Mixed"
          options={[
            { value: 'hug', label: 'Hug' },
            { value: 'fixed', label: 'Fixed' },
            { value: 'fill', label: 'Fill' },
          ]}
          onChange={(value) => setMode(dimension, value)}
        />
      </Row>
    );
  };

  const add = (
    <ChromeMenu
      align="end"
      tip={{ label: 'Add to Size' }}
      trigger={
        <button type="button" aria-label="Add to Size" className="flex size-6 items-center justify-center rounded-[6px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:ring-2 focus-visible:ring-chrome-accent">
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
      }
    >
      {LIMITS.map(({ key, label }) => (
        <ChromeMenuItem key={key} disabled={shown(key)} onSelect={() => setRevealed(new Set([...revealed, key]))}>
          {label}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );

  const columns = parent.kind === 'grid' ? gridColumnCount(target.slide, path) : 0;
  return (
    <Section title="Size" actions={add}>
      {dimensionRow('w')}
      {dimensionRow('h')}
      {LIMITS.filter(({ key }) => shown(key)).map(({ key, label }) => {
        const shared = sharedStyle(target, key);
        return (
          <Row
            key={key}
            label={label}
            onReset={() => {
              commitCss(target, key, '', label);
              const next = new Set(revealed);
              next.delete(key);
              setRevealed(next);
            }}
            resetLabel={`Remove ${label.toLowerCase()}`}
          >
            <NumberInput
              aria-label={label}
              value={shared.mixed ? null : pxOf(shared.value)}
              placeholder={shared.mixed ? 'Mixed' : key.startsWith('min') ? '0' : '—'}
              unit="px"
              min={key.startsWith('min') ? 0 : 1}
              max={4096}
              step={8}
              onCommit={(v) => commitCss(target, key, v === null ? '' : `${v}px`, label)}
            />
          </Row>
        );
      })}
      {parent.kind === 'grid' ? (
        <>
          <Row label="Column span" tip="Grid cells this child spans across (row-major auto-flow).">
            <NumberInput aria-label="Column span" value={spanOf(node.style['grid-column'])} placeholder="1" min={1} max={Math.max(1, columns)} onCommit={(v) => commitCss(target, 'grid-column', !v || v <= 1 ? '' : `span ${Math.round(v)}`, 'Column span')} />
          </Row>
          <Row label="Row span">
            <NumberInput aria-label="Row span" value={spanOf(node.style['grid-row'])} placeholder="1" min={1} max={12} onCommit={(v) => commitCss(target, 'grid-row', !v || v <= 1 ? '' : `span ${Math.round(v)}`, 'Row span')} />
          </Row>
        </>
      ) : null}
      <MarginRow target={target} />
    </Section>
  );
}

/** The four sides of a margin as written: px numbers, or `auto`. */
function marginSides(value: string | undefined): [Side, Side, Side, Side] {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [0, 0, 0, 0];
  const [t, r = t, b = t, l = r] = parts.map((part): Side => (part === 'auto' ? 'auto' : (pxOf(part) ?? 0)));
  return [t!, r!, b!, l!];
}

type Side = number | 'auto';

const sideNumber = (side: Side): number => (side === 'auto' ? 0 : side);

/** Margin of a flow child: one value, or one per side; an `auto` side stays `auto` until it is typed over. */
function MarginRow({ target }: { target: Target }): ReactNode {
  const shared = sharedStyle(target, 'margin');
  const sides = shared.mixed ? null : marginSides(shared.value);
  const shown: Quad | null = sides ? [sideNumber(sides[0]), sideNumber(sides[1]), sideNumber(sides[2]), sideNumber(sides[3])] : null;
  const commit = (next: Quad): void => {
    const written = next.map((v, i) => (sides?.[i] === 'auto' && v === shown?.[i] ? 'auto' : `${v}px`));
    commitCss(target, 'margin', written.every((v) => v === '0px') ? '' : written.join(' '), 'Margin', 'margin');
  };
  return (
    <QuadRow
      label="Margin"
      kind="sides"
      values={shown}
      unit="px"
      min={-1920}
      max={1920}
      title="Space outside the element, between it and its neighbours."
      onCommit={commit}
      onReset={shared.value && !shared.mixed ? () => commitCss(target, 'margin', '', 'Margin') : undefined}
    />
  );
}

/** How many columns the grid holding `path` has. */
function gridColumnCount(slide: Slide, path: NodePath): number {
  const style: StyleMap = (path.length > 1 ? parentAt(slide, path)?.style : slide.style) ?? {};
  const parsed = style['grid-template-columns'] ? parseTracks(style['grid-template-columns']) : null;
  return parsed?.ok ? parsed.value.length : 12;
}

function applyPatch(style: StyleMap, patch: StylePatch): StyleMap {
  const next: StyleMap = { ...style };
  for (const [key, value] of Object.entries(patch) as Array<[keyof StyleMap, string | undefined]>) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Containers                                                                  */
/* -------------------------------------------------------------------------- */

type ContainerKind = 'stack' | 'grid' | 'layered';
type Edge = 'start' | 'center' | 'end';

const GRID_ALIGN_OPTIONS = [
  { value: 'stretch', label: 'Stretch' },
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
] as const;

/** A justify / align keyword as start, center or end (null for stretch, baseline, a distribution). */
function edgeOf(value: string | undefined): Edge | null {
  switch (value) {
    case 'start':
    case 'flex-start':
      return 'start';
    case 'center':
      return 'center';
    case 'end':
    case 'flex-end':
      return 'end';
    default:
      return null;
  }
}

/** The next form of a grid track when clicked: share → fixed 240px → content → share. */
function cycleTrack(track: Track): Track {
  if (track.unit === 'fr') return { unit: 'px', value: 240 };
  if (track.unit === 'px') return { unit: 'auto' };
  return { unit: 'fr', value: 1 };
}

function trackLabel(track: Track): string {
  return track.unit === 'auto' ? 'Auto' : `${track.value}${track.unit}`;
}

/** Justify and align icons along the stack's main and cross axes. */
const ROW_ICONS = {
  justify: { start: AlignHorizontalJustifyStart, center: AlignHorizontalJustifyCenter, end: AlignHorizontalJustifyEnd },
  align: { start: AlignVerticalJustifyStart, center: AlignVerticalJustifyCenter, end: AlignVerticalJustifyEnd },
} as const;
const COLUMN_ICONS = { justify: ROW_ICONS.align, align: ROW_ICONS.justify } as const;

/**
 * Layout of a container: the selected `<div>` (one, not a group of pinned
 * shapes) or the slide's own flow root when the slide is the target. Text
 * elements lay out their own lines: only their padding is offered.
 */
export function LayoutSection({ target }: { target: Target }): ReactNode {
  const node = target.nodes.length === 1 ? target.nodes[0]! : null;
  const isSlide = target.nodes.length === 0;
  if (!isSlide && target.nodes.every((n) => n.kind === 'text' || n.kind === 'list' || n.kind === 'textbox')) {
    return (
      <Section title="Layout">
        <PaddingRow target={target} />
      </Section>
    );
  }
  if (!isSlide && node?.kind !== 'box') return null;
  if (node?.kind === 'box' && node.group) return null;
  const style = isSlide ? target.slide.style : node!.style;
  const kind: ContainerKind = style.display === 'grid' ? 'grid' : style.position === 'relative' ? 'layered' : 'stack';
  return (
    <Section title="Layout">
      <Row>
        <Segmented<ContainerKind>
          aria-label="Layout"
          value={kind}
          options={[
            { value: 'stack', label: 'Stack', title: 'Children follow one another' },
            { value: 'grid', label: 'Grid', title: 'Children fill a grid of columns' },
            ...(isSlide ? [] : [{ value: 'layered' as const, label: 'Layered', title: 'Children are placed freely on top of each other' }]),
          ]}
          onChange={(next) => setContainerKind(target, style, kind, next, isSlide)}
        />
      </Row>
      {kind === 'stack' ? <StackRows target={target} style={style} /> : null}
      {kind === 'grid' ? <GridRows target={target} style={style} /> : null}
      {kind === 'layered' ? <Note>Children are placed freely. Drag them on the slide to arrange them.</Note> : null}
      {kind !== 'layered' ? (
        <Row label="Gap">
          <NumberInput
            aria-label="Gap"
            value={sharedStyle(target, 'gap').mixed ? null : (pxOf(style.gap?.split(/\s+/)[0]) ?? 0)}
            placeholder="Mixed"
            min={0}
            max={512}
            onCommit={(v) => commitCss(target, 'gap', v ? `${v}px` : '', 'Gap', 'gap')}
          />
        </Row>
      ) : null}
      <PaddingRow target={target} />
    </Section>
  );
}

function setContainerKind(target: Target, style: StyleMap, kind: ContainerKind, next: ContainerKind, isSlide: boolean): void {
  if (next === kind) return;
  if (next === 'grid') {
    patchTarget(target, 'Grid layout', {
      display: 'grid',
      'grid-template-columns': formatTracks([{ unit: 'fr', value: 1 }, { unit: 'fr', value: 1 }]),
      'flex-direction': undefined,
      'flex-wrap': undefined,
      'justify-content': undefined,
      position: isSlide ? undefined : style.position === 'relative' ? undefined : style.position,
    });
  } else if (next === 'stack') {
    patchTarget(target, 'Stack layout', { display: undefined, 'grid-template-columns': undefined, 'grid-template-rows': undefined, 'justify-items': undefined, position: style.position === 'relative' ? undefined : style.position });
  } else {
    patchTarget(target, 'Layered layout', { position: 'relative', display: undefined, 'grid-template-columns': undefined, 'grid-template-rows': undefined });
  }
}

/** A stack's direction and wrapping, then how its children justify, align and distribute. */
function StackRows({ target, style }: { target: Target; style: StyleMap }): ReactNode {
  const row = style['flex-direction'] === 'row' || style['flex-direction'] === 'row-reverse';
  const wrap = style['flex-wrap'] === 'wrap';
  const distributed = style['justify-content'] === 'space-between';
  const justify = style['justify-content'] ? edgeOf(style['justify-content']) : 'start';
  const align = edgeOf(style['align-items']);
  const icons = row ? ROW_ICONS : COLUMN_ICONS;
  const edges = (which: 'justify' | 'align', prefix: string) =>
    (['start', 'center', 'end'] as const).map((edge) => {
      const Icon = icons[which][edge];
      return { value: edge, label: `${prefix} ${edge}`, title: `${prefix} ${edge}`, icon: <Icon strokeWidth={1.5} />, disabled: which === 'justify' && distributed, reason: 'Distribute decides this axis' };
    });
  const DistributeIcon = row ? AlignHorizontalSpaceBetween : AlignVerticalSpaceBetween;
  return (
    <>
      <Row label="Direction">
        <Segmented<'h' | 'v'>
          aria-label="Direction"
          value={row ? 'h' : 'v'}
          options={[
            { value: 'h', label: 'Horizontal', title: 'Horizontal', icon: <ArrowRight strokeWidth={1.5} /> },
            { value: 'v', label: 'Vertical', title: 'Vertical', icon: <ArrowDown strokeWidth={1.5} /> },
          ]}
          onChange={(dir) => patchTarget(target, 'Direction', dir === 'h' ? { 'flex-direction': 'row' } : { 'flex-direction': undefined, 'flex-wrap': undefined })}
        />
        <IconButton
          label={wrap ? 'Children wrap onto more rows — click for one row' : 'Wrap children onto more rows'}
          icon={<CornerDownLeft strokeWidth={1.5} />}
          active={wrap}
          disabled={!row}
          reason={!row ? 'Wrap applies to a horizontal stack' : undefined}
          onClick={() => commitCss(target, 'flex-wrap', wrap ? '' : 'wrap', 'Wrap')}
        />
      </Row>
      <Row
        label="Align"
        onReset={style['justify-content'] || style['align-items'] ? () => patchTarget(target, 'Align', { 'justify-content': undefined, 'align-items': undefined }) : undefined}
      >
        <div className={cn('flex min-w-0 flex-1 gap-2', row ? 'items-center' : 'items-start')}>
          <Segmented<Edge> aria-label="Justify" vertical={!row} className={row ? 'min-w-0 flex-1' : undefined} value={justify} options={edges('justify', 'Justify')} onChange={(edge) => commitCss(target, 'justify-content', edge === 'start' ? '' : edge, 'Justify')} />
          <Segmented<Edge> aria-label="Align" vertical={!row} className={row ? 'min-w-0 flex-1' : undefined} value={align} options={edges('align', 'Align')} onChange={(edge) => commitCss(target, 'align-items', edge, 'Align')} />
        </div>
        <IconButton
          label={distributed ? 'Distribute: space between — click to pack' : 'Distribute (space between); needs main-axis room to show'}
          icon={<DistributeIcon strokeWidth={1.5} />}
          active={distributed}
          onClick={() => commitCss(target, 'justify-content', distributed ? '' : 'space-between', 'Distribute')}
        />
      </Row>
    </>
  );
}

/** A grid's columns (click a track to cycle it), rows and cell alignment. */
function GridRows({ target, style }: { target: Target; style: StyleMap }): ReactNode {
  const parsed = style['grid-template-columns'] ? parseTracks(style['grid-template-columns']) : null;
  const tracks: Track[] = parsed?.ok ? parsed.value : [];
  const setTracks = (next: Track[]): void => {
    if (next.length > 0) commitCss(target, 'grid-template-columns', formatTracks(next), 'Grid columns');
  };
  return (
    <>
      <Row label="Columns">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {tracks.map((track, i) => (
            <button
              key={i}
              type="button"
              title="Click to switch between a share, a fixed 240px and the content's size"
              className="h-6 rounded-[6px] bg-chrome-field px-1.5 text-[12px] tabular-nums text-chrome-fg shadow-[inset_0_0_0_1px_var(--chrome-field-ring)] hover:shadow-[inset_0_0_0_1px_var(--chrome-field-ring-strong)]"
              onClick={() => setTracks(tracks.map((t, j) => (j === i ? cycleTrack(t) : t)))}
            >
              {trackLabel(track)}
            </button>
          ))}
          <IconButton label="Add column" icon={<Plus strokeWidth={1.5} />} disabled={tracks.length >= 12} reason={tracks.length >= 12 ? '12 columns at most' : undefined} onClick={() => setTracks([...tracks, { unit: 'fr', value: 1 }])} />
          <IconButton label="Remove column" icon={<Minus strokeWidth={1.5} />} disabled={tracks.length <= 1} reason={tracks.length <= 1 ? 'A grid keeps one column' : undefined} onClick={() => setTracks(tracks.slice(0, -1))} />
        </div>
      </Row>
      <Row label="Rows">
        <CssField target={target} property="grid-template-rows" label="Grid rows" placeholder="auto" />
      </Row>
      <Row label="Align">
        <SelectInput aria-label="Justify items" value={style['justify-items'] ?? 'stretch'} options={GRID_ALIGN_OPTIONS.map((o) => ({ ...o }))} onChange={(value) => commitCss(target, 'justify-items', value === 'stretch' ? '' : value, 'Align columns')} />
        <SelectInput aria-label="Align items" value={edgeOf(style['align-items']) ?? 'stretch'} options={GRID_ALIGN_OPTIONS.map((o) => ({ ...o }))} onChange={(value) => commitCss(target, 'align-items', value === 'stretch' ? '' : value, 'Align rows')} />
      </Row>
    </>
  );
}

/** Padding: one value, or one per side. */
function PaddingRow({ target }: { target: Target }): ReactNode {
  const shared = sharedStyle(target, 'padding');
  const commit = (next: Quad): void => {
    const all = next.every((v) => v === next[0]);
    commitCss(target, 'padding', all ? (next[0] ? `${next[0]}px` : '') : next.map((v) => `${v}px`).join(' '), 'Padding', 'padding');
  };
  return (
    <QuadRow
      label="Padding"
      kind="sides"
      values={shared.mixed ? null : paddingSides(shared.value)}
      unit="px"
      min={0}
      max={1920}
      onCommit={commit}
      onReset={shared.value && !shared.mixed ? () => commitCss(target, 'padding', '', 'Padding') : undefined}
    />
  );
}
