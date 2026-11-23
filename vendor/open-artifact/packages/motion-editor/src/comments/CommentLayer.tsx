import { useCallback, useMemo, type ReactElement } from 'react';
import { CommentCapture, CommentPins, CommentsButton, CommentPopover, CommentsLayer, ThreadCard, type AgentBadge } from '@open-artifact/editor-kit/react';
import type { Box, PinPlace, Point } from '@open-artifact/editor-kit';
import { useFilmSize } from '../player/StageView.tsx';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { useWorking } from '../stores/working.ts';
import { anchorShowsAt, anchorWorldBox, boxAnchorAt, filmMomentOf, pinWorldPoint, pointAnchorAt, stageCamera, type VideoAnchor } from './anchor-place.ts';
import { filmComments, useComments, useRangeMark } from './comments.ts';
import { formatPlaybackTime } from '../transport/time-format.ts';
import * as words from './words.ts';

const NO_CAMERA = { x: 0, y: 0, zoom: 1 };

export function useAgentBadge(): AgentBadge {
  const available = useWorking((s) => s.available);
  const name = useWorking((s) => s.name);
  const wakesIdle = useWorking((s) => s.wakesIdle);
  return useMemo(() => ({ available, name, wakesIdle }), [available, name, wakesIdle]);
}

/** Over the picture: pins at their moment, the composer, and clicks that place comments in comment mode. */
export function CommentLayer(): ReactElement | null {
  const available = useComments((s) => s.available);
  const active = useComments((s) => s.active);
  const draft = useComments((s) => s.draft);
  const listOpen = useComments((s) => s.listOpen);
  const threads = useComments((s) => s.threads);
  const box = useUi((s) => s.stageBox);
  const viewport = useUi((s) => s.playerSize);
  const clock = useFilm((s) => s.clock);
  const time = usePlayback((s) => s.time);
  const film = useFilmSize();
  const agent = useAgentBadge();
  const camera = useMemo(() => (box === null ? NO_CAMERA : stageCamera(box, film)), [box, film]);
  const activeAnchor = useMemo(() => {
    const thread = active === null ? undefined : threads.find((t) => t.id === active);
    return thread === undefined ? null : filmComments.anchorOf(thread);
  }, [active, threads]);
  const place = useCallback(
    (anchor: VideoAnchor): PinPlace | null => {
      const world = pinWorldPoint(anchor, film);
      if (world === null) return null;
      const open = anchor === draft || anchor === activeAnchor || (activeAnchor !== null && sameAnchor(anchor, activeAnchor));
      return open || anchorShowsAt(anchor, time, clock) ? { world, state: 'ok' } : null;
    },
    [film, draft, activeAnchor, time, clock],
  );
  const highlight = useCallback((anchor: VideoAnchor): Box | null => anchorWorldBox(anchor, film), [film]);
  const anchorAt = useCallback((world: Point): VideoAnchor => pointAnchorAt(world, film, filmMomentOf(clock, usePlayback.getState().time)), [film, clock]);
  const areaAnchor = useCallback((a: Point, b: Point): VideoAnchor => boxAnchorAt(a, b, film, filmMomentOf(clock, usePlayback.getState().time)), [film, clock]);
  if (!available || box === null) return null;
  const found = active === null ? undefined : threads.find((t) => t.id === active);
  const unplaced = found !== undefined && pinWorldPoint(filmComments.anchorOf(found), film) === null && !listOpen ? found : undefined;
  const close = (): void => {
    const state = useComments.getState();
    state.setDraft(null);
    state.setActive(null);
  };
  return (
    <div className="absolute inset-0 z-[5]" data-uncommentable="">
      <CommentCapture comments={filmComments} enabled camera={() => camera} anchorAt={anchorAt} areaAnchor={areaAnchor} highlight={highlight} revision={time} />
      <CommentPins comments={filmComments} camera={camera} viewport={viewport} place={place} highlight={highlight} agent={agent} revision={time} movable={false} piles={false} />
      <RangeMarkNote />
      {unplaced === undefined ? null : (
        <CommentsLayer mark="data-comment-layer" onEscape={() => (close(), true)}>
          <CommentPopover key={unplaced.id} corner={{ x: viewport.width / 2 - 165, y: 48 }} viewport={viewport} onEscape={close}>
            {(maxHeight) => <ThreadCard comments={filmComments} agent={agent} thread={unplaced} maxHeight={maxHeight} />}
          </CommentPopover>
        </CommentsLayer>
      )}
    </div>
  );
}

function sameAnchor(a: VideoAnchor, b: VideoAnchor): boolean {
  return filmComments.adapter.serialize(a) === filmComments.adapter.serialize(b);
}

/** While R has marked a stretch's start: where it starts, and how to comment on it. */
function RangeMarkNote(): ReactElement | null {
  const from = useRangeMark((s) => s.from);
  const on = useComments((s) => s.on);
  if (from === null || !on) return null;
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <span className="rounded-md bg-chrome px-2.5 py-1 text-[12px] shadow-chrome">{words.rangeFrom(formatPlaybackTime(from))}</span>
    </div>
  );
}

/** The toolbar's Comments button: comment mode, and the list of every comment. */
export function FilmCommentsButton(): ReactElement {
  return <CommentsButton comments={filmComments} side="top" />;
}
