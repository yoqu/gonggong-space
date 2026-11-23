/**
 * Banners above the stage: why the deck is read-only, unsaved changes found
 * from an earlier visit, a slide changed elsewhere at the same time (mine /
 * theirs / keep both; changes to different lines merge without asking),
 * versions set aside by such a choice, a save made at the same moment that
 * replaced this tab's (compare / bring back), and a slide held read-only by
 * errors in its file.
 */

import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { AlertTriangle, Bot, Columns2, History, Lock, RotateCcw, Undo2 } from 'lucide-react';
import { newSlideId } from '@open-artifact/slides-core';
import { Button, Dialog, cn } from '@open-artifact/ui';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useOrder } from '../state/outline.ts';
import { useView } from '../state/view.ts';
import { askAgentToFix, useAgent } from '../services/agent.ts';
import { clearRecovery, restoreRecovery, type Recovery } from '../services/recovery.ts';
import { schedule } from '../services/sync.ts';
import { SlideThumb } from './SlideThumb.tsx';

/** "Compare": this tab's overwritten version beside the slide as it is now. */
function CompareDialog({ position, onClose }: { position: number; onClose: () => void }): ReactNode {
  const item = useDeck((s) => s.kept[position]);
  const now = useDeck((s) => (item ? s.slides[item.id]?.slide : undefined));
  if (!item) return null;
  const bringBack = (): void => {
    useDeck.getState().bringBack(position);
    useView.getState().showSlide(item.id);
    schedule(0);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Compare versions"
      description="Your version was replaced by a save made at the same moment."
      className="w-[min(52rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep current
          </Button>
          <Button variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={bringBack} disabled={!now}>
            Bring back yours
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <figure className="flex flex-col gap-1.5">
          <figcaption className="text-xs text-fg-muted">Yours</figcaption>
          <div className="overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]">
            <SlideThumb slide={item.slide} />
          </div>
        </figure>
        <figure className="flex flex-col gap-1.5">
          <figcaption className="text-xs text-fg-muted">Current</figcaption>
          <div className="overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]">{now ? <SlideThumb slide={now} /> : <div className="aspect-video bg-surface-2" />}</div>
        </figure>
      </div>
    </Dialog>
  );
}

/** Unsaved changes found at boot, waiting for the person's choice. */
export const useRecoveryOffer = create<{ offer: Recovery | null; set(offer: Recovery | null): void }>()((set) => ({
  offer: null,
  set(offer) {
    set({ offer });
  },
}));

/** One banner row. */
function Banner({ tone, icon, children, actions }: { tone: 'info' | 'warning' | 'danger'; icon: ReactNode; children: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs',
        tone === 'info' && 'border-line bg-surface-2 text-fg',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-fg',
        tone === 'danger' && 'border-danger/30 bg-danger/10 text-fg',
      )}
    >
      <span className={cn('shrink-0', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger', tone === 'info' && 'text-fg-muted')}>{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
    </div>
  );
}

/** "about 5 minutes ago" for a timestamp. */
function minutesAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'moments ago';
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Slide numbers as "slide 3" / "slides 2, 5 and 7". */
function slideList(ids: readonly string[], order: readonly string[]): string {
  const numbers = ids.map((id) => order.indexOf(id) + 1).filter((n) => n > 0).sort((a, b) => a - b);
  if (numbers.length === 0) return 'the outline';
  if (numbers.length === 1) return `slide ${numbers[0]}`;
  return `slides ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

/** The banners. */
export function Banners(): ReactNode {
  const readOnly = useDeck((s) => s.readOnly);
  const status = useDeck((s) => s.status);
  const indexError = useDeck((s) => s.indexError);
  const kept = useDeck((s) => s.kept);
  const current = useView((s) => s.current);
  const entry = useDeck((s) => (current ? s.slides[current] : undefined));
  const conflicts = useDeck((s) => s.slides);
  const offer = useRecoveryOffer((s) => s.offer);
  const agent = useAgent((s) => s.status);
  const order = useOrder();
  const [comparing, setComparing] = useState<number | null>(null);
  if (status !== 'ready') return null;

  const conflicted = Object.keys(conflicts).filter((id) => conflicts[id]!.conflict);
  const out: ReactNode[] = [];

  if (readOnly) {
    out.push(
      <Banner key="ro" tone="info" icon={<Lock className="size-3.5" />}>
        {indexError && /newer/i.test(indexError) ? 'This presentation was saved by a newer version of Slides and opens read-only here.' : "View only. You don't have permission to edit this presentation."}
      </Banner>,
    );
  } else if (indexError) {
    out.push(
      <Banner key="index" tone="warning" icon={<AlertTriangle className="size-3.5" />}>
        The outline file can't be read ({indexError}). Slides can still be edited; the slide order and sections are read-only.
      </Banner>,
    );
  }

  if (offer && !readOnly) {
    const ids = Object.keys(offer.slides);
    out.push(
      <Banner
        key="recovery"
        tone="warning"
        icon={<History className="size-3.5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                restoreRecovery(offer);
                useRecoveryOffer.getState().set(null);
                schedule(0);
              }}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearRecovery();
                useRecoveryOffer.getState().set(null);
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        Found unsaved changes to {slideList(ids, order)} from {minutesAgo(offer.at)}. Restore them?
      </Banner>,
    );
  }

  for (const id of conflicted) {
    const conflict = conflicts[id]!.conflict!;
    const n = order.indexOf(id) + 1;
    const resolve = (choice: 'mine' | 'theirs' | 'copy'): void => {
      const state = useDeck.getState();
      const copyId = choice === 'copy' ? newSlideId(new Set([...Object.keys(state.slides), ...Object.keys(state.trash)])) : undefined;
      state.resolveConflict(id, choice, copyId);
      if (copyId) useView.getState().showSlide(copyId);
      schedule(0);
    };
    out.push(
      <Banner
        key={`conflict-${id}`}
        tone="danger"
        icon={<AlertTriangle className="size-3.5" />}
        actions={
          conflict.reason === 'deleted' ? (
            <>
              <Button size="sm" variant="primary" onClick={() => resolve('mine')}>
                Keep my version
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve('theirs')}>
                Delete it
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={() => resolve('mine')}>
                Use mine
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve('theirs')}>
                Use theirs
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve('copy')}>
                Save mine as a copy
              </Button>
            </>
          )
        }
      >
        {conflict.reason === 'deleted'
          ? `Slide ${n} was deleted elsewhere while you were editing it.`
          : `Slide ${n} was changed elsewhere at the same time as you. Choose which version to keep.`}
        {id !== current ? (
          <button type="button" className="ml-1 text-accent hover:underline" onClick={() => useView.getState().showSlide(id)}>
            Show it
          </button>
        ) : null}
      </Banner>,
    );
  }

  kept.slice(0, 3).forEach((item, position) => {
    if (item.reason === 'overwritten') {
      const n = Math.max(1, deckOrder(useDeck.getState()).indexOf(item.id) + 1);
      out.push(
        <Banner
          key={`kept-${item.at}-${item.id}`}
          tone="warning"
          icon={<Undo2 className="size-3.5" />}
          actions={
            <>
              <Button size="sm" variant="ghost" icon={<Columns2 className="size-3.5" />} onClick={() => setComparing(position)}>
                Compare
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw className="size-3.5" />}
                disabled={readOnly}
                onClick={() => {
                  useDeck.getState().bringBack(position);
                  useView.getState().showSlide(item.id);
                  schedule(0);
                }}
              >
                Bring back
              </Button>
              <Button size="sm" variant="ghost" onClick={() => useDeck.getState().dismissKept(position)}>
                Dismiss
              </Button>
            </>
          }
        >
          A save made at the same moment replaced your changes to slide {n}.
        </Banner>,
      );
      return;
    }
    out.push(
      <Banner
        key={`kept-${item.at}-${item.id}`}
        tone="info"
        icon={<Undo2 className="size-3.5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => {
                const state = useDeck.getState();
                const newId = newSlideId(new Set([...Object.keys(state.slides), ...Object.keys(state.trash)]));
                state.restoreKept(position, newId);
                useView.getState().showSlide(newId);
                schedule(0);
              }}
            >
              Restore as new slide
            </Button>
            <Button size="sm" variant="ghost" onClick={() => useDeck.getState().dismissKept(position)}>
              Dismiss
            </Button>
          </>
        }
      >
        {item.reason === 'mine-chosen' ? 'The other version' : 'Your version'} of slide {Math.max(1, deckOrder(useDeck.getState()).indexOf(item.id) + 1)} was set aside.
      </Banner>,
    );
  });

  if (entry?.held) {
    out.push(
      <Banner
        key="held"
        tone="warning"
        icon={<AlertTriangle className="size-3.5" />}
        actions={
          agent.available && !readOnly ? (
            <Button size="sm" variant="ghost" icon={<Bot className="size-3.5" />} onClick={() => void askAgentToFix([current!])}>
              Ask {agent.name} to fix
            </Button>
          ) : null
        }
      >
        This slide's file has errors, so it's read-only here: {entry.held}
      </Banner>,
    );
  }

  if (!out.length) return null;
  return (
    <div className="flex shrink-0 flex-col">
      {out}
      {comparing !== null ? <CompareDialog position={comparing} onClose={() => setComparing(null)} /> : null}
    </div>
  );
}
