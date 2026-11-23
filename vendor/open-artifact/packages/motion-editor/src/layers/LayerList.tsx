/**
 * The layers of the stretch on show as a tree: each row's icon, label and words, an eye that hides it by hand, and
 * the keys of a tree (arrows move and open, Enter or Space picks, Escape lets the pick go).
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  Boxes,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  Frame,
  Group,
  Image as ImageIcon,
  Minus,
  Pentagon,
  Shapes,
  Spline,
  Square,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { IconButton, cn } from '@open-artifact/ui';
import { isLayerOnAt, type PlacedLayer } from '@open-artifact/motion-stage/layers';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';
import { entryCounts } from './entry.ts';
import { deselectLayer, pickLayer } from './reader.ts';
import { rowEntry, setLayerProperty } from './retouch.ts';
import { liveKey, setNear, setOpen, useLayers } from './store.ts';
import { joinLabel, layerAccessibleLabel, layerIconKind, layerShortLabel, layerSummary, layerToggleName, layerTypeLabel, showsLayerCaretColumn, siblingsOf, visibleLayers, type LayerIconKind } from './tree.ts';
import * as words from './words.ts';

const ICONS: Readonly<Record<LayerIconKind, LucideIcon>> = {
  text: Type,
  image: ImageIcon,
  rectangle: Square,
  oval: Circle,
  group: Group,
  pack: Boxes,
  ground: Frame,
  line: Minus,
  path: Spline,
  polygon: Pentagon,
  graphic: Shapes,
};

/** Whether a row is hidden by hand: by what is being dragged, the record's entry for it, else the reading. */
export function rowHidden(row: LayerRow): boolean {
  const live = useLayers.getState().live.get(liveKey(row.id, 'hidden'));
  if (live !== undefined) return live === 1;
  const look = row.look;
  if (look !== null) {
    const entry = rowEntry(row, look);
    if (entry !== null) return entryCounts(entry, look, 'hidden', useLayers.getState().touched);
    if (look.entry !== null) return false;
  }
  return row.hidden === 'own';
}

/** The eye is offered where hiding by hand would hold: a layer the stage can find again, shown by the film, not inside a hidden one. */
const eyeOffered = (row: LayerRow, inHidden: boolean): boolean =>
  row.kind !== 'ground' && row.look !== null && row.look.hidden === 0 && row.look.kin !== null && !/[+*]/.test(row.id) && !inHidden && row.hidden !== 'held';

export function LayerList({ rows, at, retouchable }: { rows: readonly LayerRow[]; at: number; retouchable: boolean }): ReactElement {
  const pickedId = useLayers((s) => s.pickedId);
  const nearId = useLayers((s) => s.nearId);
  const open = useLayers((s) => s.open);
  // Read so the eyes follow writes made since the reading.
  useLayers((s) => s.touched);
  useLayers((s) => s.seen);
  useLayers((s) => s.live);
  const tree = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => visibleLayers(rows, open), [rows, open]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const current = shown.find((placed) => placed.row.id === (focusId ?? pickedId))?.row.id ?? shown[0]?.row.id ?? null;

  useEffect(() => {
    if (pickedId === null || tree.current === null) return;
    tree.current.querySelector<HTMLElement>(`[data-layer="${CSS.escape(pickedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [pickedId]);

  const focusRow = (id: string | undefined): void => {
    if (id === undefined) return;
    setFocusId(id);
    tree.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(id)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A row's buttons (the eye) take their own Enter and Space.
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('button') !== null) return;
    const index = shown.findIndex((placed) => placed.row.id === current);
    const placed = shown[index];
    if (placed === undefined) return;
    const row = placed.row;
    const hasKids = row.kids.length > 0;
    let handled = true;
    if (event.key === 'ArrowDown') focusRow(shown[index + 1]?.row.id);
    else if (event.key === 'ArrowUp') focusRow(shown[index - 1]?.row.id);
    else if (event.key === 'Home') focusRow(shown[0]?.row.id);
    else if (event.key === 'End') focusRow(shown[shown.length - 1]?.row.id);
    else if (event.key === 'ArrowRight') {
      if (hasKids && open.has(row.id)) focusRow(row.kids[0]?.id);
      else if (hasKids) setOpen(row.id, true);
    } else if (event.key === 'ArrowLeft') {
      if (hasKids && open.has(row.id)) setOpen(row.id, false);
      else focusRow(placed.ups[placed.ups.length - 1]?.id);
    } else if (event.key === 'Enter' || event.key === ' ') pickLayer(row);
    else if (event.key === 'Escape') handled = deselectLayer();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div ref={tree} role="tree" aria-label={words.LAYER_TREE_LABEL} className="flex flex-col py-0.5" onKeyDown={onKeyDown} onMouseLeave={() => setNear(null)} data-layers-tree="">
      {shown.map((placed) => (
        <LayerItem
          key={placed.row.id}
          placed={placed}
          siblings={siblingsOf(rows, placed)}
          at={at}
          picked={placed.row.id === pickedId}
          near={placed.row.id === nearId}
          open={open.has(placed.row.id)}
          tabbable={placed.row.id === current}
          retouchable={retouchable}
          onFocus={() => setFocusId(placed.row.id)}
        />
      ))}
    </div>
  );
}

function LayerItem({
  placed,
  siblings,
  at,
  picked,
  near,
  open,
  tabbable,
  retouchable,
  onFocus,
}: {
  placed: PlacedLayer;
  siblings: readonly LayerRow[];
  at: number;
  picked: boolean;
  near: boolean;
  open: boolean;
  tabbable: boolean;
  retouchable: boolean;
  onFocus: () => void;
}): ReactElement {
  const { row, ups } = placed;
  const hasKids = row.kids.length > 0;
  const showsCarets = showsLayerCaretColumn(ups.length, siblings);
  const hiddenUp = ups.find((up) => rowHidden(up)) ?? null;
  const inHidden = hiddenUp !== null || row.hidden === 'held';
  const hidden = rowHidden(row);
  const off = row.box === null || !isLayerOnAt(row, at);
  const Icon = ICONS[layerIconKind(row)];
  const type = layerTypeLabel(row);
  const summary = layerSummary(row);
  const toggleName = layerToggleName(row, siblings);
  const offered = retouchable && eyeOffered(row, inHidden);
  const label = joinLabel([
    type,
    summary,
    hidden ? words.HIDDEN_ROW : '',
    off ? words.OFF_PICTURE : '',
    hiddenUp !== null ? words.hiddenWith(layerShortLabel(hiddenUp)) : '',
  ]);

  const toggle = (): void => {
    if (row.look === null) return;
    setLayerProperty({ row, look: row.look, property: 'hidden', v: hidden ? null : 1 }, hidden ? words.UNDO_SHOW : words.UNDO_HIDE);
  };

  return (
    <div
      role="treeitem"
      aria-level={ups.length + 1}
      aria-posinset={siblings.indexOf(row) + 1}
      aria-setsize={siblings.length}
      aria-expanded={hasKids ? open : undefined}
      aria-selected={picked}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      data-layer={row.id}
      className={cn(
        'group flex h-7 cursor-default select-none items-center rounded-control pr-1 text-xs outline-none focus-visible:outline-2 focus-visible:outline-accent',
        picked ? 'bg-accent-soft font-medium text-fg' : near ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2',
      )}
      style={{ paddingLeft: 6 + 16 * ups.length + (showsCarets ? 0 : 2) }}
      onClick={() => pickLayer(row)}
      onMouseEnter={() => setNear(row.id)}
      onFocus={onFocus}
    >
      {hasKids ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${layerAccessibleLabel(row)}`}
          className="flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(row.id, !open);
          }}
        >
          <ChevronRight className={cn('size-3 transition-transform', open ? 'rotate-90' : 'rotate-0')} />
        </button>
      ) : showsCarets ? (
        <span aria-hidden className="w-5 shrink-0" />
      ) : null}
      <span className={cn('flex min-w-0 flex-1 items-center gap-1.5', hidden || inHidden ? 'opacity-50' : 'opacity-100')}>
        <Icon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
        <span className={cn('min-w-0 flex-initial truncate', off && !picked ? 'text-fg-subtle' : undefined)} title={type}>
          {type}
        </span>
        {summary !== '' ? <span className="min-w-0 flex-1 truncate font-normal text-fg-subtle">{summary}</span> : null}
      </span>
      {offered ? (
        <span className={cn('shrink-0', hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')} onClick={(event) => event.stopPropagation()}>
          <IconButton
            size="sm"
            label={hidden ? words.showLayer(toggleName) : words.hideLayer(toggleName)}
            title={hidden ? words.SHOW : words.HIDE}
            noTooltip
            tabIndex={tabbable ? 0 : -1}
            icon={hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            onClick={toggle}
          />
        </span>
      ) : null}
    </div>
  );
}
