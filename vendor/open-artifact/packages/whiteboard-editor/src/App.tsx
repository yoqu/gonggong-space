/**
 * The Whiteboard editor: connects to the host, starts live sync, and lays
 * out the board surface with its floating chrome.
 *
 * ```
 * .wb-root
 *   BoardContextMenu                 right-click / long-press menus
 *     BoardSurface
 *       camera layer (board units)   ElementsLayer, UploadPlaceholders, CollabBoardLayer, NextItemOffer
 *       overlay (screen units)       SelectionOverlay, CollabOverlay
 *   TimerEndGlow, BoardPill, BoardFoot, SelectionBar, LinkCard, CollabChrome, FindBar,
 *   VersionHistory                   the history panel and a past version's preview
 * ```
 */

import { useEffect, useState } from 'react';
import { EmptyState } from '@open-artifact/ui';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { BoardSurface } from './canvas/BoardSurface.tsx';
import { CollabBoardLayer, CollabChrome, CollabOverlay, UploadPlaceholders } from './collab/index.ts';
import { ElementsLayer } from './elements/ElementsLayer.tsx';
import { FindBar } from './find/FindBar.tsx';
import { NextItemOffer } from './selection/NextItemOffer.tsx';
import { SelectionOverlay } from './selection/SelectionOverlay.tsx';
import { useBoardRecovery, showBoardMedia } from './services/load-recovery.ts';
import { startBoard } from './services/boot.ts';
import { BoardPill } from './ui/BoardPill.tsx';
import { BoardContextMenu } from './ui/ContextMenu.tsx';
import { LinkCard } from './ui/LinkCard.tsx';
import { SelectionBar } from './ui/SelectionBar.tsx';
import { TimerEndGlow } from './ui/Timer.tsx';
import { BoardFoot } from './ui/Toolbar.tsx';
import { VersionHistory } from './ui/VersionHistory.tsx';
import './tools/index.ts';

type Phase = { kind: 'starting' } | { kind: 'ready' } | { kind: 'failed'; message: string };

/**
 * The running board. Starting it wires page-wide singletons (the session,
 * the sync engine, input listeners), so it starts once per page: React's
 * development double mount (unmount, then mount again at once) keeps the
 * same run instead of tearing it down under the second mount.
 */
let run: { ready: Promise<() => void>; holders: number; stopTimer: ReturnType<typeof setTimeout> | undefined } | null = null;

/** Starts the board, or joins the run already started. */
function holdBoard(): Promise<unknown> {
  run ??= { ready: startBoard(), holders: 0, stopTimer: undefined };
  clearTimeout(run.stopTimer);
  run.stopTimer = undefined;
  run.holders += 1;
  return run.ready;
}

/** Leaves the run; the last holder stops it, unless the editor mounts again right away. */
function releaseBoard(): void {
  const current = run;
  if (!current) return;
  current.holders -= 1;
  if (current.holders > 0) return;
  current.stopTimer = setTimeout(() => {
    if (run !== current || current.holders > 0) return;
    run = null;
    current.ready.then(
      (stop) => stop(),
      () => {},
    );
  }, 0);
}

/** The editor root. */
export function App() {
  const paused = useBoardRecovery((state) => state.paused);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });

  useEffect(() => {
    let cancelled = false;
    holdBoard()
      .then(() => {
        if (!cancelled) setPhase({ kind: 'ready' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
      releaseBoard();
    };
  }, []);

  if (phase.kind === 'failed') {
    return (
      <EmptyState icon={<TriangleAlert className="size-6" />} title="This board could not open">
        {phase.message}
      </EmptyState>
    );
  }

  const ready = phase.kind === 'ready';
  return (
    <div className="wb-root">
      <BoardContextMenu>
        <BoardSurface
          overlay={
            ready ? (
              <>
                <SelectionOverlay />
                <CollabOverlay />
              </>
            ) : null
          }
          elements={<ElementsLayer />}
        >
          {ready ? <UploadPlaceholders /> : null}
          {ready ? <CollabBoardLayer /> : null}
          {ready ? <NextItemOffer /> : null}
        </BoardSurface>
      </BoardContextMenu>
      {ready ? (
        <>
          {paused && <div role="status" className="wb-recovery">
            Pictures and embeds are paused because the last load was interrupted.
            <button type="button" onClick={() => void showBoardMedia()}>Show pictures and embeds</button>
          </div>}
          <TimerEndGlow />
          <BoardPill />
          <BoardFoot />
          <SelectionBar />
          <LinkCard />
          <CollabChrome />
          <FindBar />
          <VersionHistory />
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-fg-muted" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-label="Opening the board" />
        </div>
      )}
    </div>
  );
}
