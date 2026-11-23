import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pause, RotateCcw } from 'lucide-react';
import { ChromeButton, ToolButton } from '@open-artifact/editor-kit/react';
import { Section, cn, isComposingKey } from '@open-artifact/ui';
import type { EditableWord, EditableWordGroup } from '@open-artifact/motion-core';
import { useComments } from '../comments/comments.ts';
import { pause } from '../engine/actions.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import { retypeWords } from './edit.ts';
import { groupWords } from './text-model.ts';
import { useEditableWords, useText } from './text-store.ts';
import * as words from './words.ts';

const HEADINGS: Record<NonNullable<EditableWordGroup> | 'null', string> = {
  null: words.WORDS_ON_SCREEN,
  more: words.MORE_TEXT,
  later: words.ELSEWHERE_IN_SCENE,
  'not-on-screen': words.NOT_ON_SCREEN,
};

const heading = (group: EditableWordGroup): string => HEADINGS[group ?? 'null'];

function TextField({ word, number, order, disabled }: { word: EditableWord; number: number; order: () => string[]; disabled: boolean }): ReactElement {
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(word.text);
  const focused = useText((s) => s.held?.id === word.id);
  const near = useText((s) => s.near === word.id);
  const asked = useText((s) => (s.asked?.id === word.id ? s.asked.seq : null));
  useEffect(() => {
    if (!focused) setDraft(word.text);
  }, [word.text, focused]);
  useEffect(() => {
    if (asked === null || field.current === null) return;
    field.current.focus();
    field.current.scrollIntoView({ block: 'nearest' });
  }, [asked]);
  const commit = (): void => {
    if (draft !== word.text && !retypeWords(word.id, draft)) setDraft(word.text);
  };
  const label = words.textNumber(number);
  return (
    <div
      className={cn('group flex items-start gap-1 rounded-md', near && !focused && 'bg-chrome-hover')}
      onPointerEnter={() => useText.setState({ near: word.id })}
      onPointerLeave={() => useText.setState((state) => (state.near === word.id ? { near: null } : state))}
    >
      <textarea
        ref={field}
        aria-label={label}
        value={draft}
        rows={Math.min(4, Math.max(1, Math.ceil(draft.length / 34)))}
        maxLength={word.max}
        disabled={disabled}
        data-video-text={word.id}
        className={cn(
          'min-h-[26px] min-w-0 flex-1 resize-none rounded-[5px] bg-chrome-field px-2 py-[5px] text-[13px] leading-4 text-chrome-fg ring-1 ring-chrome-ring outline-none',
          'focus:ring-2 focus:ring-chrome-focus disabled:opacity-50',
        )}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => useText.setState({ held: word, order: order() })}
        onBlur={() => {
          commit();
          useText.setState({ held: null, order: null });
        }}
        onKeyDown={(event) => {
          if (isComposingKey(event.nativeEvent)) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setDraft(word.text);
            // The draft is put back before blur commits it.
            requestAnimationFrame(() => field.current?.blur());
          }
        }}
      />
      {word.changed ? (
        <ToolButton label={words.resetText(number)} tipSide="left" size="md" disabled={disabled} icon={<RotateCcw />} onClick={() => retypeWords(word.id, '')} />
      ) : (
        <span className="size-8 shrink-0" />
      )}
    </div>
  );
}

/** Text under Tweaks: a field per line of the picture's words, while the film is paused. */
export function TextSection(): ReactElement | null {
  const ready = useFilm((s) => s.stage === 'ready');
  const playing = usePlayback((s) => s.playing);
  const commentsOn = useComments((s) => s.on);
  const readOnly = useWorking((s) => s.readOnlyReason !== null);
  const agent = useWorking((s) => s.name);
  const { words: list, fieldless } = useEditableWords();
  if (!ready) return null;
  const order = (): string[] => list.map((word) => word.id);
  let body: ReactElement;
  if (commentsOn) body = <p className="text-xs text-chrome-muted">{words.FINISH_COMMENTING}</p>;
  else if (playing)
    body = (
      <ChromeButton className="self-start" onClick={pause}>
        <Pause className="size-4" />
        {words.PAUSE_TO_CHANGE_TEXT}
      </ChromeButton>
    );
  else if (list.length === 0) body = <p className="text-xs text-chrome-muted">{words.noTextHere(agent)}</p>;
  else {
    let number = 0;
    body = (
      <>
        {groupWords(list).map(({ group, words: grouped }) => (
          <div key={group ?? 'on-screen'} className="flex flex-col gap-1.5" role="group" aria-label={heading(group)}>
            <h4 className={cn('text-[13px] leading-4 font-[520]', group === null ? 'text-chrome-fg' : 'text-chrome-muted')}>{heading(group)}</h4>
            {grouped.map((word) => {
              number += 1;
              return <TextField key={word.id} word={word} number={number} order={order} disabled={readOnly} />;
            })}
          </div>
        ))}
        {fieldless.length > 0 ? <p className="text-xs text-chrome-muted">{words.fieldlessHint(agent)}</p> : null}
      </>
    );
  }
  return <Section title={words.TEXT}>{body}</Section>;
}
