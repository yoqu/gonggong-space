import { useMemo, type ReactElement } from 'react';
import { COMMENT_TARGET } from '@open-artifact/editor-kit/react';
import { useFilm } from '../stores/film.ts';
import { timelineMark, type TimelineMark } from './anchor-place.ts';
import { filmComments, useComments } from './comments.ts';
import * as words from './words.ts';

/** Each open thread's moment (a dot) or stretch (a bar) on the scrub track; a press shows the thread. */
export function TimelineMarks({ total }: { total: number }): ReactElement | null {
  const available = useComments((s) => s.available);
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const active = useComments((s) => s.active);
  const clock = useFilm((s) => s.clock);
  const marks = useMemo(
    () =>
      threads
        .filter((thread) => showResolved || thread.status === 'open')
        .map((thread) => timelineMark(thread.id, filmComments.anchorOf(thread), clock, total))
        .filter((mark): mark is TimelineMark => mark !== null),
    [threads, showResolved, clock, total],
  );
  if (!available || marks.length === 0) return null;
  const show = (id: string): void => {
    const thread = useComments.getState().threads.find((t) => t.id === id);
    if (thread !== undefined) filmComments.show(thread);
  };
  return (
    <>
      {marks.map((mark) => (
        <button
          key={mark.id}
          type="button"
          aria-label={words.commentAt(filmComments.labelOf(filmComments.anchorOf(threads.find((t) => t.id === mark.id) ?? { anchor: '' })))}
          data-active={mark.id === active ? '' : undefined}
          className="absolute -top-1 h-1.5 min-w-1.5 rounded-full opacity-80 hover:opacity-100 data-[active]:opacity-100"
          style={{ backgroundColor: COMMENT_TARGET, left: `${mark.from * 100}%`, width: mark.to === null ? undefined : `${Math.max(0, mark.to - mark.from) * 100}%` }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => show(mark.id)}
        />
      ))}
    </>
  );
}
