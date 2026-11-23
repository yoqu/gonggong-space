/**
 * Pieces shared by the Grid and Canvas views: a slide tile (thumbnail with
 * its number and marks), a section label with an editable one-sentence
 * description, and the "+" between tiles that adds a slide or a section.
 */

import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AlertTriangle, EyeOff, ListPlus, MessageCircle, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { LIMITS, normalizeDescription, slideTitle, type SectionEntry } from '@open-artifact/slides-core';
import { IconButton, Menu, MenuItem, cn } from '@open-artifact/ui';
import { useDeck } from '../../state/deck.ts';
import { useView } from '../../state/view.ts';
import type { PeerView } from '../../services/agent.ts';
import { addSectionAt, addSlide, canChange, describeOpeningRun, moveSection, removeSection, setSectionDescription, targetSlides } from '../../services/commands.ts';
import { ContextMenu } from '../ContextMenu.tsx';
import { useArriving } from '../Creation.tsx';
import { startSectionDrag } from './sectionDrag.ts';
import { PeerDots } from '../Rail.tsx';
import { SlideMenuItems } from '../SlideMenu.tsx';
import { SlideThumb } from '../SlideThumb.tsx';

/** Props of {@link SlideTile}. */
export interface SlideTileProps {
  id: string;
  /** Place in the deck order (0-based). */
  index: number;
  comments: number;
  peers: readonly PeerView[] | undefined;
  /** Being dragged (drawn faded). */
  dragging: boolean;
  /** An insertion line on the left (a drag hovers the gap before it). */
  dropBefore: boolean;
  /** An insertion line on the right (the gap after the last slide). */
  dropAfter: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  /** Double-click: open the slide for editing. */
  onOpen: (id: string) => void;
  /** Width of the tile, px (CSS width otherwise). */
  width?: number;
}

/** One slide in the grid or on the canvas. */
export const SlideTile = memo(function SlideTile({ id, index, comments, peers, dragging, dropBefore, dropAfter, onPointerDown, onOpen, width }: SlideTileProps): ReactNode {
  const entry = useDeck((s) => s.slides[id]);
  const current = useView((s) => s.current === id);
  const selected = useView((s) => s.slideSelection.includes(id));
  const arriving = useArriving(id);
  if (!entry) return null;
  const problem = entry.held ?? (entry.conflict ? 'Changed elsewhere at the same time' : null);
  const title = slideTitle(entry.slide);
  return (
    <ContextMenu
      menu={<SlideMenuItems ids={useView.getState().slideSelection.includes(id) ? targetSlides() : [id]} />}
      onOpen={() => {
        if (!useView.getState().slideSelection.includes(id)) useView.getState().showSlide(id);
      }}
      className="relative shrink-0 outline-none"
      style={width ? { width } : undefined}
    >
      {dropBefore ? <span aria-hidden className="absolute -left-[13px] inset-y-0 w-1 rounded bg-accent" /> : null}
      {dropAfter ? <span aria-hidden className="absolute -right-[13px] inset-y-0 w-1 rounded bg-accent" /> : null}
      <div
        data-slide-index={index}
        data-slide-id={id}
        role="option"
        aria-selected={selected || current}
        aria-label={`Slide ${index + 1}${title ? `: ${title}` : ''}`}
        onPointerDown={(event) => onPointerDown(event, id)}
        onDoubleClick={() => onOpen(id)}
        className={cn('group cursor-default', dragging && 'opacity-40', arriving && 'oa-arrive')}
      >
        <div
          className={cn(
            'relative overflow-hidden rounded-md ring-1 ring-line transition-shadow',
            selected || current ? 'ring-2 ring-accent' : 'group-hover:ring-line-strong',
            entry.slide.hidden && 'opacity-50',
          )}
        >
          <SlideThumb slide={entry.slide} virtual />
          <div className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1">
            <PeerDots peers={peers} />
            {comments ? (
              <span className="flex items-center gap-0.5 rounded-full bg-surface px-1.5 text-[10px] text-fg shadow-popup">
                <MessageCircle className="size-2.5" />
                {comments}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-1.5 text-[11px] text-fg-muted">
          <span className={cn('tabular-nums', (selected || current) && 'font-semibold text-fg')}>{index + 1}</span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {entry.slide.hidden ? <EyeOff className="size-3 shrink-0" aria-label="Skipped" /> : null}
          {problem ? <AlertTriangle className="size-3 shrink-0 text-warning" aria-label={problem} /> : null}
        </div>
      </div>
    </ContextMenu>
  );
});

/** Props of {@link SectionLabel}. */
export interface SectionLabelProps {
  /** The section, or null for the opening run (the slides before the first section). */
  section: SectionEntry | null;
  /** 0-based place among the outline's rows. */
  n: number;
  /** The row's slides (to describe the opening run, and for moves). */
  ids: readonly string[];
  /** Gap between rows before the previous row, or null on the first row. */
  previousGap: number | null;
  /** Gap between rows after the next row, or null on the last row. */
  nextGap: number | null;
  className?: string;
}

/** A row's label: "Section N", its description, and its actions. */
export function SectionLabel({ section, n, ids, previousGap, nextGap, className }: SectionLabelProps): ReactNode {
  const key = section?.key ?? '-';
  const editing = useView((s) => s.editingSection === key);
  const selected = useView((s) => s.sectionSelection.includes(key));
  const editable = useDeck((s) => !s.readOnly && !s.indexError) && canChange();
  const description = section?.description ?? '';
  const title = `Section ${n + 1}`;
  // The opening run can be described only once it has slides to start at.
  const describable = editable && (section !== null || ids.length > 0);

  const commit = (raw: string): void => {
    useView.getState().setEditingSection(null);
    const text = normalizeDescription(raw);
    if (text === description) return;
    if (section) setSectionDescription(section.key, text);
    else if (ids[0]) describeOpeningRun(ids[0], text);
  };

  return (
    <div
      data-section-label={key}
      className={cn('group/label flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1', selected && 'bg-accent-soft', section && editable && 'cursor-grab', className)}
      onPointerDown={(event) => {
        // The description button still starts a drag (a click without travel edits it); other buttons and the editor do not.
        const target = event.target as HTMLElement;
        if (event.button !== 0 || target.closest('textarea') || (target.closest('button') && !target.closest('[data-section-describe]'))) return;
        const view = useView.getState();
        const mod = event.metaKey || event.ctrlKey || event.shiftKey;
        // Pressing a selected label keeps the selection, so several sections drag together.
        if (mod) view.selectSections(selected ? view.sectionSelection.filter((k) => k !== key) : [...view.sectionSelection, key]);
        else if (!selected || !section || !editable) view.selectSections([key]);
        view.selectSlides([...ids]);
        if (section && editable && !mod) startSectionDrag(event, section.key);
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{title}</div>
        {editing ? (
          <DescriptionInput initial={description} onCommit={commit} onCancel={() => useView.getState().setEditingSection(null)} />
        ) : (
          <button
            type="button"
            data-section-describe
            disabled={!describable}
            aria-label={description || (describable ? `${title}, Describe this section` : title)}
            className={cn(
              'block max-w-full truncate text-left text-sm',
              description ? 'text-fg' : 'text-fg-subtle',
              describable && 'hover:text-fg',
            )}
            onClick={() => describable && useView.getState().setEditingSection(key)}
          >
            {description || (describable ? 'Describe this section' : '')}
          </button>
        )}
      </div>
      {editable && section ? (
        <Menu
          trigger={
            <IconButton
              size="sm"
              noTooltip
              label={`Actions for ${title}`}
              icon={<MoreHorizontal className="size-3.5" />}
              className="opacity-0 group-hover/label:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            />
          }
          align="end"
        >
          <MenuItem onSelect={() => useView.getState().setEditingSection(key)}>Describe {title}</MenuItem>
          <MenuItem disabled={previousGap === null} onSelect={() => previousGap !== null && moveSection(section.key, previousGap)}>
            Move section earlier
          </MenuItem>
          <MenuItem disabled={nextGap === null} onSelect={() => nextGap !== null && moveSection(section.key, nextGap)}>
            Move section later
          </MenuItem>
          <MenuItem icon={<Plus className="size-4" />} disabled={ids.length === 0} onSelect={() => void addSlide('blank', ids.at(-1) ?? null)}>
            Add a slide to this section
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-4" />} danger onSelect={() => removeSection(section.key)}>
            Remove section
          </MenuItem>
        </Menu>
      ) : null}
    </div>
  );
}

/** The description field: one sentence, Enter commits, Escape cancels. */
function DescriptionInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (text: string) => void; onCancel: () => void }): ReactNode {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={2}
      value={value}
      maxLength={LIMITS.sectionDescription}
      placeholder="Describe this section"
      aria-label="Section description"
      className="mt-0.5 block w-full resize-none rounded border border-accent bg-canvas px-1.5 py-1 text-sm text-fg outline-none"
      onChange={(event) => setValue(event.target.value.replace(/\n/g, ' '))}
      onBlur={() => {
        if (done.current) return;
        done.current = true;
        onCommit(value);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          done.current = true;
          onCommit(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
    />
  );
}

/**
 * The "+" in the gap after a tile: add a slide or start a section there.
 * `gap` is the deck index right after `after`.
 */
export function GapAdd({ gap, after, className }: { gap: number; after: string; className?: string }): ReactNode {
  if (!canChange()) return null;
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label="Add a slide or section here"
          className={cn(
            'flex size-6 items-center justify-center rounded-full border border-line bg-surface text-fg-muted opacity-0 shadow-popup transition-opacity hover:text-fg focus-visible:opacity-100 group-hover/gap:opacity-100 pointer-coarse:opacity-100',
            className,
          )}
        >
          <Plus className="size-3.5" />
        </button>
      }
      align="center"
    >
      <MenuItem icon={<Plus className="size-4" />} onSelect={() => void addSlide('blank', after)}>
        New slide here
      </MenuItem>
      <MenuItem icon={<ListPlus className="size-4" />} onSelect={() => addSectionAt(gap)}>
        New section here
      </MenuItem>
    </Menu>
  );
}
