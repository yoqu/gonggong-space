import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { SceneBuildSummary } from '@open-artifact/motion-core';
import { Button } from '@open-artifact/ui';
import { askContinue, askFinalize } from '../agent/requests.ts';
import { useWorking } from '../stores/working.ts';
import { useSceneSummary } from './scene-summary.ts';
import { seemsStopped, workingBarView } from './waiting.ts';
import { useWaitingAnnouncement } from './waiting-announcement.ts';
import { advanceEstimate, pauseEstimate, timeLeft, timeLeftWords, type WorkEstimate } from './work-estimate.ts';
import * as words from './words.ts';

const MANY_PIPS = 12;
const STOPPED_CHECK_MS = 5000;

/** Whether the agent seems to have stopped, checked every few seconds. */
function useSeemsStopped(missing: number): boolean {
  const activity = useWorking((s) => s.activity);
  const lastWrite = useWorking((s) => s.lastFilmWriteAt);
  const readOnly = useWorking((s) => !s.canAsk);
  const waitsOnYou = useWorking((s) => s.waitsOnYou);
  const [opened] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (missing === 0) return;
    const timer = setInterval(() => setNow(Date.now()), STOPPED_CHECK_MS);
    return () => clearInterval(timer);
  }, [missing]);
  return seemsStopped({ missing, activity, lastWriteAt: lastWrite ?? opened, now, readOnly, waitsOnYou });
}

/** The time the agent's work on the scenes may still take, while it works; `null` otherwise, or while it waits on the person. */
function useTimeLeft(summary: SceneBuildSummary | null, stopped: boolean): string | null {
  const working = useWorking((s) => s.activity === 'working');
  const waitsOnYou = useWorking((s) => s.waitsOnYou);
  const count = working && summary?.count != null ? summary.count : null;
  const estimate = useRef<WorkEstimate | null>(null);
  const waitedFrom = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (count === null) return;
    const timer = setInterval(() => setNow(Date.now()), STOPPED_CHECK_MS);
    return () => clearInterval(timer);
  }, [count === null]);
  const at = Math.max(now, Date.now());
  // The time spent waiting on the person is left out of the estimate's clock.
  if (waitsOnYou && waitedFrom.current === null) waitedFrom.current = at;
  if (!waitsOnYou && waitedFrom.current !== null) {
    estimate.current = pauseEstimate(estimate.current, at - waitedFrom.current);
    waitedFrom.current = null;
  }
  estimate.current = advanceEstimate(estimate.current, count === null ? null : { what: count.what, toCome: count.of - count.n, of: count.of }, at);
  if (estimate.current === null || stopped || waitsOnYou) return null;
  return timeLeftWords(timeLeft(estimate.current, at));
}

/** Over the top of the picture while a film is being made scene by scene: progress, and Continue or Finalize. */
export function WorkingBar(): ReactElement | null {
  const summary = useSceneSummary();
  const asked = useWorking((s) => s.asked);
  const agent = useWorking((s) => s.name);
  const canAsk = useWorking((s) => s.canAsk);
  const waitsOnYou = useWorking((s) => s.waitsOnYou);
  const stopped = useSeemsStopped(summary?.left.length ?? 0);
  const left = useTimeLeft(summary, stopped);
  const view = summary === null ? null : workingBarView({ summary, asked, waitsOnYou });
  useWaitingAnnouncement(view !== null && waitsOnYou);
  if (summary === null || view === null) return null;
  const says = stopped ? words.seemsStopped(agent) : view.says;
  const button = view.button ?? (stopped ? (summary.left.length > 0 ? 'continue' : null) : null);
  const ask = (): void => {
    if (button === 'continue') void askContinue(summary.left);
    else if (button === 'finalize') void askFinalize();
  };
  return (
    <div role="group" aria-label={words.SCENES} className="absolute inset-x-0 top-0 z-[6] flex flex-col gap-1 px-3 pt-3">
      <div className="flex items-center gap-2 rounded-lg bg-chrome/90 px-3 py-1.5 text-[13px] shadow-chrome backdrop-blur">
        {view.rough ? <span className="rounded-md bg-chrome-hover px-1.5 py-0.5 text-[11px] font-medium">{words.ROUGH_CUT}</span> : null}
        {says !== null ? <span className="tabular-nums text-chrome-muted">{says}</span> : null}
        {left !== null ? <span className="tabular-nums text-chrome-muted">· {left}</span> : null}
        {view.pips !== null ? (
          <span aria-hidden="true" className="flex flex-wrap items-center gap-1" style={{ maxWidth: Math.min(view.pips.length, MANY_PIPS) * 10 }}>
            {view.pips.map((pip, index) => (
              <span key={index} className="vid-pip" data-pip={pip} />
            ))}
          </span>
        ) : null}
        <span className="flex-1" />
        {canAsk && button !== null ? (
          <Button size="sm" variant={button === 'continue' ? 'secondary' : 'primary'} disabled={asked !== null} onClick={ask}>
            {button === 'continue' ? words.CONTINUE : words.FINALIZE}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
