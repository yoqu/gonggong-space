import type { ReactElement, ReactNode } from 'react';
import { CircleAlert, Clapperboard, LoaderCircle } from 'lucide-react';
import { Button } from '@open-artifact/ui';
import { askFixError } from '../agent/requests.ts';
import { useFilm, type StageProblem } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { formatPlaybackTime } from '../transport/time-format.ts';
import { useWaitingAnnouncement } from './waiting-announcement.ts';
import { filmView } from './waiting.ts';
import * as words from './words.ts';

function Cover({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'dim' }): ReactElement {
  return (
    <div
      className={`absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 px-6 text-center ${tone === 'dim' ? 'bg-black/55 text-white' : 'bg-stage-ground text-chrome-fg'}`}
      role="status"
    >
      {children}
    </div>
  );
}

function ErrorCover({ problem }: { problem: StageProblem }): ReactElement {
  const agent = useWorking((s) => s.name);
  const canAsk = useWorking((s) => s.canAsk);
  return (
    <Cover tone="dim">
      <CircleAlert className="size-6" aria-hidden="true" />
      <p className="text-[15px] font-medium">{words.STOPPED_WITH_ERROR}</p>
      <p className="text-[13px] opacity-80">{problem.phase === 'load' ? words.IN_LOADING : words.IN_RENDERING}</p>
      {problem.at !== null ? <p className="text-[13px] opacity-80">{words.failedAt(formatPlaybackTime(problem.at))}</p> : null}
      <pre className="max-h-32 max-w-[min(560px,100%)] overflow-auto whitespace-pre-wrap rounded-md bg-black/40 px-3 py-2 text-left font-mono text-[12px]">
        {problem.message}
      </pre>
      {canAsk ? (
        <Button variant="primary" onClick={() => void askFixError(problem)}>
          {words.askToFix(agent)}
        </Button>
      ) : null}
    </Cover>
  );
}

/** What covers the picture while there is none to show: connecting, empty, loading, or stopped by an error. */
export function FilmStates(): ReactElement | null {
  const sync = useWorking((s) => s.sync);
  const activity = useWorking((s) => s.activity);
  const agent = useWorking((s) => s.name);
  const canAsk = useWorking((s) => s.canAsk);
  const waitsOnYou = useWorking((s) => s.waitsOnYou);
  const hasScript = useFilm((s) => s.hasScript);
  const stage = useFilm((s) => s.stage);
  const problem = useFilm((s) => s.stageProblem);
  const view = filmView({ sync, hasScript, stage, problem, activity });
  useWaitingAnnouncement(view.kind === 'starting' && waitsOnYou);
  switch (view.kind) {
    case 'playing':
      return null;
    case 'connecting':
    case 'loading':
      return (
        <Cover>
          <LoaderCircle className="size-5 animate-spin text-chrome-muted" aria-hidden="true" />
          <p className="text-[13px] text-chrome-muted">{words.LOADING}</p>
        </Cover>
      );
    case 'unavailable':
      return (
        <Cover>
          <p className="text-[13px] text-chrome-muted">{words.LIVE_SYNC_UNAVAILABLE}</p>
          <Button onClick={() => location.reload()}>{words.RELOAD}</Button>
        </Cover>
      );
    case 'starting':
      return (
        <Cover>
          {waitsOnYou ? null : <LoaderCircle className="size-5 animate-spin text-chrome-muted" aria-hidden="true" />}
          <p className="text-[15px] font-medium">{waitsOnYou ? words.WAITING_FOR_YOU : words.gettingStarted(agent)}</p>
          <p className="text-[13px] text-chrome-muted">{words.PLAYS_HERE_YOURS}</p>
        </Cover>
      );
    case 'empty':
      return (
        <Cover>
          <Clapperboard className="size-6 text-chrome-muted" aria-hidden="true" />
          <p className="text-[15px] font-medium">{words.NO_ANIMATION}</p>
          <p className="text-[13px] text-chrome-muted">{canAsk ? words.NOTHING_TO_PLAY : words.PLAYS_HERE}</p>
        </Cover>
      );
    case 'error':
      return <ErrorCover problem={view.problem} />;
    default: {
      const never: never = view;
      return never;
    }
  }
}
