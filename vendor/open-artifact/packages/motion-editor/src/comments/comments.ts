/**
 * Comments on the film. The host keeps the threads (the `comments` capability); a thread's anchor is a moment and
 * a point (or box) of the frame, or a stretch of the timeline (`anchor-place.ts`).
 *
 * Comment mode (the Comments button, the Shell's, or C) pauses the film and makes clicks on the picture place
 * comments; R marks the start of a stretch and Enter comments on it (or on the middle of the frame). Esc leaves.
 */

import { create } from 'zustand';
import { toast } from '@open-artifact/ui';
import { createComments, openMessageCount } from '@open-artifact/editor-kit';
import {
  ANCHOR_ROOT,
  decodeAnimationAnchor,
  describeAnimationAnchor,
  encodeAnimationAnchor,
  makeRangeCommentAnchor,
  playSeconds,
  type AnchorClock,
} from '@open-artifact/motion-core';
import { pause, seekTo } from '../engine/actions.ts';
import { maybeSession } from '../host/session.ts';
import { onShellCommand, setShellReport } from '../host/shell.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import { FILM_ANCHOR, filmMomentOf, pointAnchorAt, revealTime, type VideoAnchor } from './anchor-place.ts';
import * as words from './words.ts';

export const MAX_THREADS = 500;
const MODE_ATTR = 'data-video-commenting';
const HOST_MODE_ATTR = 'data-comment-mode';

const clock = (): AnchorClock => useFilm.getState().clock;

export const filmComments = createComments<VideoAnchor>({
  notify: (message) => toast.add(message),
  parse: (text) => decodeAnimationAnchor(text) ?? FILM_ANCHOR,
  serialize: (anchor) => (anchor.kind === 'film' ? ANCHOR_ROOT : encodeAnimationAnchor(anchor)),
  label: (anchor) => (anchor.kind === 'film' ? words.WHOLE_ANIMATION : describeAnimationAnchor(anchor, clock()).label),
  detail: (anchor) => (anchor.kind === 'film' ? undefined : describeAnimationAnchor(anchor, clock()).detail),
  location: (anchor) => ({ location: anchor.kind === 'film' ? words.WHOLE_ANIMATION : describeAnimationAnchor(anchor, clock()).label }),
  state: (anchor) => {
    if (anchor.kind === 'film') return 'ok';
    const total = useFilm.getState().meta?.duration ?? null;
    return total !== null && revealTime(anchor, clock()) > total + 0.05 ? 'orphaned' : 'ok';
  },
  reveal: (anchor) => {
    pause();
    seekTo(revealTime(anchor, clock()));
  },
  canComment: () => maybeSession()?.canComment ?? false,
  canSendToAgent: () => (maybeSession()?.canAsk ?? false) && maybeSession()?.agent !== null && useWorking.getState().available,
  canRemove: () => maybeSession()?.canRemoveComments ?? false,
  agentName: () => useWorking.getState().name,
  agentWakesIdle: () => useWorking.getState().wakesIdle,
  viewerName: () => maybeSession()?.viewer.name ?? words.YOU,
  onModeChange: (on) => {
    if (on) pause();
  },
  noun: 'animation',
  maxThreads: MAX_THREADS,
});

export const useComments = filmComments.store;

/** Where R marked the start of a stretch (seconds as played), or `null`. */
export const useRangeMark = create<{ from: number | null }>()(() => ({ from: null }));

/** Turns comment mode on or off (on only for someone who may comment). */
export function setCommentMode(on: boolean): void {
  if (on && !filmComments.canComment()) return;
  useComments.getState().setOn(on);
}

export const commenting = (): boolean => useComments.getState().on;
/** Comment mode is on with nothing open: the keys that place comments apply. */
export const placing = (): boolean => {
  const { on, draft, active } = useComments.getState();
  return on && draft === null && active === null;
};

/** Opens the composer on an anchor (comment mode on). */
export function draftComment(anchor: VideoAnchor): void {
  if (!filmComments.canComment()) return;
  setCommentMode(true);
  const state = useComments.getState();
  state.setActive(null);
  state.setDraft(anchor);
}

/** R: marks where a stretch starts; pressed again, forgets it. */
export function toggleRangeMark(): void {
  const { from } = useRangeMark.getState();
  useRangeMark.setState({ from: from === null ? usePlayback.getState().time : null });
}

/** Enter: comments on the marked stretch up to now, or on the middle of the frame now. */
export function commentHere(): void {
  const now = usePlayback.getState().time;
  const { from } = useRangeMark.getState();
  useRangeMark.setState({ from: null });
  if (from !== null) {
    const range = makeRangeCommentAnchor(playSeconds(from), playSeconds(now), clock());
    if (range !== null) return draftComment(range);
    toast.add({ title: words.RANGE_TOO_SHORT });
  }
  const meta = useFilm.getState().meta;
  const film = { width: meta?.width ?? 1920, height: meta?.height ?? 1080 };
  draftComment(pointAnchorAt({ x: film.width / 2, y: film.height / 2 }, film, filmMomentOf(clock(), now)));
}

/** A range comment over a stretch as played (a scene's "Ask for a change"). */
export function commentOnStretch(from: number, to: number): void {
  const range = makeRangeCommentAnchor(playSeconds(from), playSeconds(to), clock());
  draftComment(range ?? FILM_ANCHOR);
}

function reportToShell(): void {
  const { available, on, listOpen, threads } = useComments.getState();
  setShellReport({ comments: { available, on, open: listOpen, count: openMessageCount(threads), pageButton: false } });
}

/** Starts comments: loads the threads (the `?comment=` thread opens) and follows the Shell's commands. */
export function startComments(): () => void {
  const capability = maybeSession()?.comments ?? null;
  const open = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('comment');
  void filmComments.start(capability, open);
  const stops: (() => void)[] = [() => filmComments.stop()];
  stops.push(
    useComments.subscribe((state, previous) => {
      if (state.on !== previous.on) {
        document.documentElement.toggleAttribute(MODE_ATTR, state.on);
        document.documentElement.toggleAttribute(HOST_MODE_ATTR, state.on);
        if (!state.on) useRangeMark.setState({ from: null });
      }
      if (state.on !== previous.on || state.threads !== previous.threads || state.listOpen !== previous.listOpen || state.available !== previous.available)
        reportToShell();
    }),
  );
  stops.push(
    onShellCommand((command) => {
      if (command.cmd === 'comments_mode') setCommentMode(command.on ?? !useComments.getState().on);
      else if (command.cmd === 'comments_list') useComments.getState().setListOpen(command.open ?? !useComments.getState().listOpen);
    }),
  );
  reportToShell();
  return () => {
    for (const stop of stops.reverse()) stop();
    document.documentElement.removeAttribute(MODE_ATTR);
    document.documentElement.removeAttribute(HOST_MODE_ATTR);
    setShellReport({ comments: undefined });
  };
}
