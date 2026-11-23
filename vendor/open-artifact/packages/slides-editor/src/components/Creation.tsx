/**
 * Creation progress, while the agent writes a deck: skeleton cells for the
 * slides the outline plans but that are not written yet (the next one marked
 * with the agent's cursor), slides drawn "arriving", a status line with
 * rotating tips, and a live region that announces "Presentation ready, N
 * slides" or "N slides updated" when the agent stops.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { useDeck } from '../state/deck.ts';
import { useAgent } from '../services/agent.ts';
import { usePlanned, useCreation } from '../services/creation.ts';
import { CREATION_TIMING, nextTipDelay, tipIndexAt, tipText } from '../services/creation-plan.ts';

/** The tip shown now, rotating while `enabled`. */
function useTip(startedAt: number, enabled: boolean): string {
  const agent = useAgent((s) => s.status.name);
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      const elapsed = Date.now() - startedAt;
      setIndex(tipIndexAt(elapsed));
      timer = setTimeout(tick, nextTipDelay(elapsed));
    };
    tick();
    return () => clearTimeout(timer);
  }, [startedAt, enabled]);
  return tipText(index, agent);
}

/** The agent's cursor parked on the cell being written. */
function AgentCursor({ compact = false }: { compact?: boolean }): ReactNode {
  const agent = useAgent((s) => s.status.name);
  return (
    <span className={cn('absolute flex items-center gap-1 rounded-full bg-accent font-medium text-white shadow-popup', compact ? 'bottom-1 left-1 px-1.5 py-px text-[9px]' : 'bottom-2 left-2 px-2 py-0.5 text-[11px]')}>
      <Sparkles className={compact ? 'size-2.5' : 'size-3'} aria-hidden />
      {agent}
    </span>
  );
}

/** One planned slide not written yet. */
export function PlannedCell({ n, next, stagger = 0, compact = false, className }: { n: number; next: boolean; stagger?: number; compact?: boolean; className?: string }): ReactNode {
  return (
    <div
      role="presentation"
      aria-label={`Slide ${n}, not written yet`}
      className={cn('oa-cell-in relative overflow-hidden rounded-[4px] bg-surface-2 ring-1 ring-line', className)}
      style={{ aspectRatio: `${SLIDE_WIDTH} / ${SLIDE_HEIGHT}`, animationDelay: `${stagger}ms` }}
    >
      <div className={cn('absolute inset-0 flex flex-col justify-center gap-[6%] px-[10%]', next && 'animate-pulse')} aria-hidden>
        <span className="h-[9%] w-3/5 rounded-sm bg-line" />
        <span className="h-[5%] w-4/5 rounded-sm bg-line/70" />
        <span className="h-[5%] w-2/3 rounded-sm bg-line/70" />
      </div>
      {next ? <AgentCursor compact={compact} /> : null}
    </div>
  );
}

/** The planned cells of the rail, after the written slides. */
export function RailPlanned({ first }: { first: number }): ReactNode {
  const planned = usePlanned();
  if (!planned.length) return null;
  return (
    <>
      {planned.map((id, i) => (
        <div key={id} className="mb-1 flex flex-col items-end">
          <div className="relative p-1">
            <span className="absolute inset-y-0 right-full w-5 pr-2 pt-1 text-right text-[13px] leading-5 tabular-nums text-chrome-muted">{first + i + 1}</span>
            <PlannedCell n={first + i + 1} next={i === 0} stagger={i * CREATION_TIMING.cellStagger} compact className="w-[135px]" />
          </div>
        </div>
      ))}
    </>
  );
}

/** The planned cells of the grid, after the written slides. */
export function GridPlanned({ first, columns, tile, gap }: { first: number; columns: number; tile: number; gap: number }): ReactNode {
  const planned = usePlanned();
  if (!planned.length) return null;
  return (
    <div className="mb-8 grid" style={{ gridTemplateColumns: `repeat(${columns}, ${tile}px)`, columnGap: gap, rowGap: gap }} aria-label="Slides still being written">
      {planned.map((id, i) => (
        <div key={id}>
          <PlannedCell n={first + i + 1} next={i === 0} stagger={i * CREATION_TIMING.cellStagger} className="rounded-md" />
          <div className="pt-1.5 text-[11px] tabular-nums text-fg-subtle">{first + i + 1}</div>
        </div>
      ))}
    </div>
  );
}

/** An empty deck the agent is writing: its outline as skeleton cells, the tip line under them. */
export function CreationView(): ReactNode {
  const planned = usePlanned();
  const startedAt = useCreation((s) => s.startedAt);
  const title = useDeck((s) => s.index.title.trim());
  const tip = useTip(startedAt, true);
  // No outline yet: a few placeholder cells.
  const cells = planned.length ? planned : ['a', 'b', 'c'];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto bg-stage px-8 py-12" aria-busy="true">
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-base font-medium text-fg">{title || 'New presentation'}</h2>
        <p className="text-xs text-fg-muted">{planned.length ? `${planned.length} ${planned.length === 1 ? 'slide' : 'slides'} planned` : 'Planning the outline…'}</p>
      </div>
      <div className="grid w-full max-w-3xl grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
        {cells.map((id, i) => (
          <PlannedCell key={id} n={i + 1} next={i === 0} stagger={i * CREATION_TIMING.cellStagger} />
        ))}
      </div>
      <p key={tip} className="oa-tip-in text-center text-xs text-fg-muted" aria-live="off">
        {tip}
      </p>
    </div>
  );
}

/** A floating status line while the agent writes a deck that has slides: "Writing slide 4 of 9" and a tip. */
export function CreationStatus(): ReactNode {
  const writing = useCreation((s) => s.writing && s.creating);
  const startedAt = useCreation((s) => s.startedAt);
  const planned = usePlanned();
  const written = useDeck((s) => Object.keys(s.slides).length);
  const tip = useTip(startedAt, writing);
  if (!writing || written === 0) return null;
  const total = written + planned.length;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[72px] z-20 flex justify-center">
      <div className="flex max-w-[min(32rem,calc(100%-2rem))] items-center gap-2 rounded-full bg-chrome px-3 py-1.5 text-xs text-chrome-fg shadow-chrome">
        <Sparkles className="size-3.5 shrink-0 text-chrome-accent" aria-hidden />
        {planned.length ? <span className="shrink-0 tabular-nums font-medium">{`${written} of ${total}`}</span> : null}
        <span key={tip} className="oa-tip-in truncate text-chrome-secondary">
          {tip}
        </span>
      </div>
    </div>
  );
}

/** Announces the end of a writing session to screen readers. */
export function CreationAnnouncer(): ReactNode {
  const announcement = useCreation((s) => s.announcement);
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {announcement ? <span key={announcement.n}>{announcement.text}</span> : null}
    </div>
  );
}

/** True while slide `id` is drawn arriving. */
export function useArriving(id: string): boolean {
  return useCreation((s) => s.fresh.has(id));
}
