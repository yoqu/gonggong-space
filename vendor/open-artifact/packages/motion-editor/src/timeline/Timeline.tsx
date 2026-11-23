import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject } from 'react';
import { playSeconds } from '@open-artifact/motion-core';
import { pause, play, seekTo } from '../engine/actions.ts';
import { selectChapters, selectDuration, selectFps, selectParts, useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { formatPlaybackTime, spokenPosition } from '../transport/time-format.ts';
import { TimelineMarks } from '../comments/TimelineMarks.tsx';
import { useTimelineSeams, type LaneContext } from './lanes.ts';
import { SceneStrip } from './SceneStrip.tsx';
import { partSpans, scrubTime, spanAt, timeToX } from './timeline-math.ts';
import { useStill } from './use-still.ts';
import * as words from './words.ts';

const PREVIEW_WIDTH = 160;
/** The timeline's side padding (px-3, both sides): the strip is this much narrower than the timeline. */
const SIDE_PADDING = 24;

function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void => setWidth(Math.max(0, element.clientWidth - SIDE_PADDING));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Under the player: the scrub track with chapters and comment marks, the scene strip, and any added lanes. */
export function Timeline(): ReactElement | null {
  const total = useFilm(selectDuration);
  const fps = useFilm(selectFps);
  const parts = useFilm(selectParts);
  const lanes = useTimelineSeams((s) => s.lanes);
  const [ref, width] = useWidth();
  const spans = useMemo(() => partSpans(parts, total, width), [parts, total, width]);
  const context: LaneContext = useMemo(() => ({ total, width, spans }), [total, width, spans]);
  return (
    <div ref={ref} role="group" aria-label={words.TIMELINE} className="relative flex shrink-0 flex-col gap-1.5 px-3 pb-2" data-video-timeline="">
      {total > 0 && width > 0 ? (
        <>
          <ScrubTrack total={total} fps={fps} width={width} />
          <SceneStrip context={context} />
          {lanes.map((lane) => (
            <div key={lane.id} className="relative" style={{ height: lane.height }}>
              {lane.render(context)}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function ScrubTrack({ total, fps, width }: { total: number; fps: number; width: number }): ReactElement {
  const time = usePlayback((s) => s.time);
  const chapters = useFilm(selectChapters);
  const parts = useFilm(selectParts);
  const hover = useUi((s) => s.hoverTime);
  const scrubbing = useRef<{ resume: boolean } | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const timeAt = (event: ReactPointerEvent): number => {
    const rect = track.current?.getBoundingClientRect();
    return rect === undefined ? 0 : scrubTime(event.clientX - rect.left, total, rect.width, fps);
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbing.current = { resume: usePlayback.getState().playing };
    pause();
    seekTo(timeAt(event));
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const t = timeAt(event);
    useUi.setState({ hoverTime: playSeconds(t) });
    if (scrubbing.current !== null) seekTo(t);
  };
  const up = (): void => {
    const resume = scrubbing.current?.resume ?? false;
    scrubbing.current = null;
    if (resume) play();
  };
  const spans = partSpans(parts, total, width);
  const chapter = spanAt(spans, time)?.label ?? chapterAt(chapters, time);
  return (
    <div className="relative pt-1">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={words.PLAYHEAD}
        aria-valuemin={0}
        aria-valuemax={Math.floor(total)}
        aria-valuenow={Math.floor(time)}
        aria-valuetext={spokenPosition(time, total, chapter)}
        className="relative h-5 cursor-pointer touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-chrome-accent"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => useUi.setState({ hoverTime: null })}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--vid-track)]">
          <div className="h-full rounded-full bg-[var(--vid-played)]" style={{ width: `${(Math.min(time, total) / total) * 100}%` }} />
        </div>
        {chapters.map((mark) => (
          <span
            key={`${mark.t}:${mark.label}`}
            title={mark.label}
            className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-chrome-muted"
            style={{ left: `${(mark.t / total) * 100}%` }}
          />
        ))}
        <TimelineMarks total={total} />
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--vid-played)] shadow"
          style={{ left: `${(Math.min(time, total) / total) * 100}%` }}
        />
      </div>
      {hover !== null && scrubbing.current === null ? <HoverPreview t={hover} total={total} width={width} /> : null}
    </div>
  );
}

function chapterAt(chapters: readonly { t: number; label: string }[], time: number): string | null {
  let label: string | null = null;
  for (const mark of chapters) if (mark.t <= time + 1e-6) label = mark.label;
  return label;
}

/** A still and the time under the pointer, above the track. */
function HoverPreview({ t, total, width }: { t: number; total: number; width: number }): ReactElement {
  const filmWidth = useFilm((s) => s.meta?.width ?? 1920);
  const filmHeight = useFilm((s) => s.meta?.height ?? 1080);
  const url = useStill(t, PREVIEW_WIDTH);
  const height = Math.round((PREVIEW_WIDTH * filmHeight) / Math.max(1, filmWidth));
  const left = Math.min(Math.max(0, timeToX(t, total, width) - PREVIEW_WIDTH / 2), Math.max(0, width - PREVIEW_WIDTH));
  return (
    <div aria-hidden="true" className="pointer-events-none absolute bottom-full z-10 mb-1 flex flex-col items-center gap-1" style={{ left, width: PREVIEW_WIDTH }}>
      <div className="overflow-hidden rounded-md border border-chrome-line bg-[var(--vid-track)] shadow-chrome" style={{ width: PREVIEW_WIDTH, height }}>
        {url === null ? null : <img src={url} alt="" className="block h-full w-full" />}
      </div>
      <span className="rounded bg-chrome px-1.5 py-0.5 text-[11px] tabular-nums shadow-chrome">{formatPlaybackTime(t)}</span>
    </div>
  );
}
