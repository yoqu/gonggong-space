/**
 * The slide rail: a 192px column on the left, headed by "+ Add slide" and
 * the View menu, then the slides as 135px thumbnails with their numbers in
 * the gutter and skip, held, conflict, comment and presence marks. Slides
 * are multi-selected, dragged to reorder, and have a right-click menu.
 * Sections show in the grid and canvas views, not here.
 */

import { memo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AlertTriangle, EyeOff, MessageCircle } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { useDeck } from '../state/deck.ts';
import { useCommentCounts, useOrder, usePeersBySlide } from '../state/outline.ts';
import { useView } from '../state/view.ts';
import type { PeerView } from '../services/agent.ts';
import { targetSlides } from '../services/commands.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { SlideMenuItems } from './SlideMenu.tsx';
import { SlideThumb } from './SlideThumb.tsx';
import { RailPlanned, useArriving } from './Creation.tsx';
import { StartControls } from './StartCard.tsx';
import { useSlideDrag } from './useSlideDrag.ts';

/** Width of the rail, px. */
export const RAIL_WIDTH = 192;

/** Up to three presence dots, then a count. */
export function PeerDots({ peers }: { peers: readonly PeerView[] | undefined }): ReactNode {
  if (!peers?.length) return null;
  const shown = peers.slice(0, 3);
  return (
    <span className="flex -space-x-1" title={peers.map((p) => p.name).join(', ')}>
      {shown.map((peer) => (
        <span
          key={peer.id}
          className="flex size-4 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-1 ring-chrome"
          style={{ background: peer.color }}
        >
          {peer.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {peers.length > 3 ? <span className="pl-1.5 text-[10px] text-chrome-muted">+{peers.length - 3}</span> : null}
    </span>
  );
}

interface ThumbProps {
  id: string;
  index: number;
  comments: number;
  peers: readonly PeerView[] | undefined;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
}

/** One rail thumbnail. */
const RailThumb = memo(function RailThumb({ id, index, comments, peers, dragging, onPointerDown }: ThumbProps): ReactNode {
  const entry = useDeck((s) => s.slides[id]);
  const current = useView((s) => s.current === id);
  const selected = useView((s) => s.slideSelection.includes(id) && s.slideSelection.length > 1);
  const arriving = useArriving(id);
  if (!entry) return null;
  const n = index + 1;
  const problem = entry.held ?? (entry.conflict ? 'Changed elsewhere at the same time' : null);
  return (
    <ContextMenu
      menu={<SlideMenuItems ids={useView.getState().slideSelection.includes(id) ? targetSlides() : [id]} />}
      onOpen={() => {
        if (!useView.getState().slideSelection.includes(id)) useView.getState().showSlide(id);
      }}
      className="mb-1 outline-none"
    >
      <div
        data-slide-index={index}
        role="option"
        aria-selected={current || selected}
        aria-label={`Slide ${n}`}
        onPointerDown={(event) => onPointerDown(event, id)}
        className={cn('group relative cursor-default rounded-[6px] p-1', !current && 'hover:bg-chrome-hover', dragging && 'opacity-40', arriving && 'oa-arrive')}
      >
        <div className="absolute inset-y-0 right-full flex w-5 flex-col items-end gap-1 pr-2 pt-1 text-[13px] leading-5 tabular-nums">
          <span className={current ? 'font-medium text-chrome-accent' : 'text-chrome-muted'}>{n}</span>
          {entry.slide.hidden ? <EyeOff className="size-3 text-chrome-muted" aria-label="Skipped" /> : null}
          {problem ? <AlertTriangle className="size-3 text-warning" aria-label={problem} /> : null}
        </div>
        <div
          className={cn(
            'relative w-[135px] rounded-[4px] outline-3 outline-offset-2',
            current ? 'outline-chrome-accent' : selected ? 'outline-chrome-accent/45' : 'outline-transparent',
          )}
        >
          <div className={cn('overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]', entry.slide.hidden && 'opacity-50')}>
            <SlideThumb slide={entry.slide} virtual />
          </div>
          <div className="pointer-events-none absolute bottom-1 left-1">
            <PeerDots peers={peers} />
          </div>
          {comments ? (
            <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center gap-0.5 rounded-full bg-chrome-accent px-1 text-[10px] font-medium text-white">
              <MessageCircle className="size-2.5" />
              {comments}
            </span>
          ) : null}
        </div>
      </div>
    </ContextMenu>
  );
});

/** The rail. */
export function Rail(): ReactNode {
  const order = useOrder();
  const counts = useCommentCounts();
  const peers = usePeersBySlide();
  const dropGap = useView((s) => s.dropGap);
  const scroller = useRef<HTMLDivElement>(null);
  const { drag, onPointerDown } = useSlideDrag(scroller, 'y');
  const dragging = new Set(drag?.ids ?? []);

  const line = (gap: number): ReactNode =>
    drag && dropGap === gap ? <div className="-mt-0.5 mb-0.5 h-0.5 w-[143px] shrink-0 rounded bg-chrome-accent" aria-hidden /> : null;

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-r border-chrome-sep bg-chrome text-chrome-fg" style={{ width: RAIL_WIDTH }} aria-label="Slides">
      <div className="shrink-0 border-b border-chrome-sep">
        <StartControls className="flex-wrap justify-between gap-y-1 px-2 py-4" />
      </div>
      <div
        ref={scroller}
        role="listbox"
        aria-multiselectable
        data-open-artifact-thumbs
        className="flex min-h-0 flex-1 flex-col items-end overflow-y-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {order.map((id, index) => (
          <div key={id} className="flex flex-col items-end">
            {line(index)}
            <RailThumb id={id} index={index} comments={counts.get(id) ?? 0} peers={peers.get(id)} dragging={dragging.has(id)} onPointerDown={onPointerDown} />
          </div>
        ))}
        {line(order.length)}
        <RailPlanned first={order.length} />
      </div>
    </aside>
  );
}
