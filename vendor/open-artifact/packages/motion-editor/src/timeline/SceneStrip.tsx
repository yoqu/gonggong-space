import { memo, type ReactElement } from 'react';
import type { SceneState } from '@open-artifact/motion-stage';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { useTimelineSeams, type LaneContext } from './lanes.ts';
import { SceneMenu } from './SceneMenu.tsx';
import { formatSceneSeconds, thumbnailTimes, type PartSpan } from './timeline-math.ts';
import { useStill } from './use-still.ts';
import * as words from './words.ts';

export const STRIP_HEIGHT = 56;
const THUMB_HEIGHT = 36;

/** The scene cards along the timeline: a still or two, the name, the length, and the scene's menu. */
export function SceneStrip({ context }: { context: LaneContext }): ReactElement | null {
  const reports = useFilm((s) => s.meta?.scenes ?? null);
  const filmWidth = useFilm((s) => s.meta?.width ?? 1920);
  const filmHeight = useFilm((s) => s.meta?.height ?? 1080);
  const sceneEdge = useTimelineSeams((s) => s.sceneEdge);
  if (context.spans.length === 0) return null;
  const thumbWidth = Math.max(1, Math.round((THUMB_HEIGHT * filmWidth) / Math.max(1, filmHeight)));
  return (
    <div role="list" aria-label={words.SCENES} className="relative" style={{ height: STRIP_HEIGHT }}>
      {context.spans.map((span) => {
        const state = span.key === null ? null : (reports?.find((report) => report.id === span.key)?.state ?? null);
        return (
          <div key={`${span.index}:${span.key ?? ''}`} role="listitem" className="absolute top-0 bottom-0 px-px" style={{ left: span.left, width: span.width }}>
            <SceneCard span={span} count={context.spans.length} state={state} thumbWidth={thumbWidth} />
            {sceneEdge?.(span, context) ?? null}
          </div>
        );
      })}
    </div>
  );
}

const SceneCard = memo(function SceneCard({ span, count, state, thumbWidth }: { span: PartSpan; count: number; state: SceneState | null; thumbWidth: number }): ReactElement {
  const missing = state === 'todo' || state === 'failed';
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-md border border-chrome-line bg-chrome"
      data-scene-state={state ?? undefined}
      title={`${words.sceneNumber(span.index + 1)}: ${span.label}`}
    >
      <div className="flex shrink-0 overflow-hidden bg-[var(--vid-track)]" style={{ height: THUMB_HEIGHT }}>
        {missing ? <MissingScene state={state} /> : <Stills span={span} thumbWidth={thumbWidth} />}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 text-[11px] leading-none">
        <span className="min-w-0 flex-1 truncate">{span.label}</span>
        {span.width > 72 ? <span className="shrink-0 tabular-nums text-chrome-muted">{formatSceneSeconds(span.dur)}</span> : null}
        {span.width > 48 ? <SceneMenu span={span} count={count} /> : null}
      </div>
    </div>
  );
});

function MissingScene({ state }: { state: SceneState | null }): ReactElement {
  const working = useWorking((s) => s.activity === 'working');
  const text = state === 'failed' ? words.FAILED : working ? words.MAKING : words.NOT_MADE_YET;
  return <span className="m-auto truncate px-1 text-[11px] text-chrome-muted">{text}</span>;
}

function Stills({ span, thumbWidth }: { span: PartSpan; thumbWidth: number }): ReactElement {
  const times = thumbnailTimes(span, thumbWidth);
  return (
    <>
      {times.map((t) => (
        <Still key={t} t={t} width={thumbWidth} />
      ))}
    </>
  );
}

function Still({ t, width }: { t: number; width: number }): ReactElement {
  const url = useStill(t, width);
  return (
    <span className="block h-full shrink-0" style={{ width }}>
      {url === null ? null : <img src={url} alt="" draggable={false} className="block h-full w-full object-cover" />}
    </span>
  );
}
