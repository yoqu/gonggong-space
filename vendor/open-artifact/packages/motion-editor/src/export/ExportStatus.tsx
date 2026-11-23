/** The export dialog past its picks: the long-export question, the progress, what was saved, and what went wrong. */

import type { ReactNode } from 'react';
import { useWorking } from '../stores/working.ts';
import { formatDuration, heldWhere, progressPercent } from './options.ts';
import type { ExportStep, Progress } from './store.ts';
import * as words from './words.ts';

function Line({ tone = 'muted', children }: { tone?: 'muted' | 'warning' | 'plain'; children: ReactNode }): ReactNode {
  const color = tone === 'warning' ? 'text-warning' : tone === 'plain' ? '' : 'text-fg-muted';
  return <p className={`text-xs ${color}`}>{children}</p>;
}

function ProgressView({ progress }: { progress: Progress }): ReactNode {
  const share = progressPercent(progress.done, progress.total);
  const phase = progress.phase === null ? words.STARTING : words.PHASES[progress.phase];
  const counted = progress.phase === 'frames' && progress.total > 0 ? words.framesProgress(progress.done, progress.total, share) : progress.total > 0 ? words.percent(share) : '';
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span>{phase}</span>
        <span className="tabular-nums text-fg-muted">{counted}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${share}%` }} />
      </div>
      <Line>{words.KEEP_OPEN}</Line>
    </div>
  );
}

function DoneView({ step }: { step: Extract<ExportStep, { kind: 'done' }> }): ReactNode {
  const agent = useWorking((state) => state.name);
  const kind = step.format === 'gif' ? 'gif' : 'video';
  const clearAtStart = step.format === 'mov' && step.held?.first?.t === 0;
  return (
    <div className="flex flex-col gap-2">
      <Line tone="plain">{words.exported(step.filename)}</Line>
      {step.delivery.to === 'host' ? (step.delivery.savedTo !== null ? <Line>{words.savedTo(step.delivery.savedTo)}</Line> : null) : <Line>{words.SAVED_BY_BROWSER}</Line>}
      {step.held !== null ? (
        <Line tone="warning">
          {words.heldFrames(step.held.count, step.held.total, heldWhere(step.held), kind, clearAtStart)} {step.fix !== null ? words.askToFixThen(agent) : ''}
        </Line>
      ) : null}
      {step.leftOut.fonts.length > 0 ? <Line tone="warning">{words.fontsLeftOut(step.leftOut.fonts)}</Line> : null}
      {step.leftOut.files.length > 0 ? <Line tone="warning">{words.filesLeftOut(step.leftOut.files)}</Line> : null}
    </div>
  );
}

/** The body for every step but the picks. */
export function ExportStatus({ step }: { step: Exclude<ExportStep, { kind: 'options' }> }): ReactNode {
  switch (step.kind) {
    case 'confirm':
      return (
        <div className="flex flex-col gap-1">
          <Line tone="plain">{words.LONG_EXPORT_TITLE}</Line>
          <Line>{words.longExport(formatDuration(step.seconds))}</Line>
        </div>
      );
    case 'running':
      return <ProgressView progress={step.progress} />;
    case 'done':
      return <DoneView step={step} />;
    case 'failed':
      return (
        <div className="flex flex-col gap-1">
          <Line tone="plain">{step.title}</Line>
          <Line>{step.message}</Line>
        </div>
      );
    default: {
      const never: never = step;
      return never;
    }
  }
}
