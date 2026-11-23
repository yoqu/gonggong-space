import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { RotateCcw } from 'lucide-react';
import type { VoiceoverLine } from '@open-artifact/motion-audio';
import { VOICE_SETTINGS } from '@open-artifact/motion-core';
import { Button, IconButton, Section, Tooltip, cn } from '@open-artifact/ui';
import { seekTo } from '../engine/actions.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { lineKeys, voiceClock, voiceWords } from './lines.ts';
import { recordVoiceChanges, voiceRequestFor } from './record.ts';
import { useVoiceover } from './store.ts';
import * as words from './words.ts';

/** The Voiceover section of the Tweaks panel: each line's words to change, then sent to the agent to record. */
export function VoiceoverSection(): ReactElement | null {
  const lines = useVoiceover((s) => s.lines);
  if (lines === null || !lines.some((line) => line.text.trim() !== '')) return null;
  return <VoiceoverLines lines={lines} />;
}

function VoiceoverLines({ lines }: { lines: readonly VoiceoverLine[] }): ReactElement {
  const typed = useVoiceover((s) => s.typed);
  const out = useVoiceover((s) => s.out);
  const asked = useVoiceover((s) => s.asked);
  const clock = useFilm((s) => s.clock);
  const readOnly = useWorking((s) => s.readOnlyReason !== null);
  const atWork = useWorking((s) => s.activity === 'working');
  const agent = useWorking((s) => s.name);
  const keys = useMemo(() => lineKeys(lines), [lines]);
  const pending = useMemo(() => voiceRequestFor(lines, typed, clock), [lines, typed, clock]);
  const recordable = pending !== null && !atWork && !asked;
  const record = (): void => {
    if (recordable) void recordVoiceChanges();
  };
  return (
    <Section title={words.VOICEOVER}>
      <div data-voiceover="" className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <LineField
            key={keys[index]}
            line={line}
            lineKey={keys[index]!}
            number={index + 1}
            typed={typed[keys[index]!]}
            locked={readOnly || asked || out.has(keys[index]!)}
            going={out.has(keys[index]!)}
            onEnter={record}
          />
        ))}
        <div className="flex flex-col gap-1.5 pt-1 text-[11px] text-chrome-muted">
          {readOnly ? (
            <p>{words.READ_ONLY}</p>
          ) : (
            <>
              <Tooltip label={words.recordTip(agent)} side="top">
                <Button
                  size="sm"
                  variant={recordable ? 'primary' : 'secondary'}
                  className="self-start"
                  disabled={!recordable}
                  aria-busy={asked}
                  onClick={record}
                >
                  {pending === null ? words.RECORD_CHANGES : words.recordCount(pending.keys.length)}
                </Button>
              </Tooltip>
              {pending !== null && pending.keys.length < pending.changes ? <p>{words.moreWithNextPress(pending.changes - pending.keys.length)}</p> : null}
              {atWork && !asked && pending !== null ? <p>{words.waitForAgent(agent)}</p> : null}
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

interface LineFieldProps {
  line: VoiceoverLine;
  lineKey: string;
  number: number;
  typed: string | undefined;
  locked: boolean;
  going: boolean;
  onEnter: () => void;
}

function LineField({ line, lineKey, number, typed, locked, going, onEnter }: LineFieldProps): ReactElement {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const focused = useRef(false);
  const own = voiceWords(line.text);
  const changed = typed !== undefined && voiceWords(typed) !== own;
  const max = VOICE_SETTINGS.maxLineChars;
  const clock = voiceClock(line.at);
  // A field taken away while it has the focus says so on its way.
  useEffect(
    () => () => {
      if (focused.current) useVoiceover.getState().select(null);
    },
    [],
  );
  const type = (value: string): void => useVoiceover.getState().type(lineKey, value === own ? undefined : value);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') event.currentTarget.blur();
    else if (!event.shiftKey) onEnter();
  };
  return (
    <div data-voice-line={number} data-going={going ? '' : undefined} className="flex flex-col gap-0.5">
      <div className="flex h-6 items-center justify-between">
        <Button variant="ghost" size="sm" className="tabular-nums text-chrome-muted" aria-label={words.goToLine(number, clock)} onClick={() => seekTo(line.at)}>
          {clock}
        </Button>
        {typed !== undefined && !locked ? (
          <IconButton
            label={words.resetLine(number)}
            size="sm"
            icon={<RotateCcw />}
            className="opacity-50 hover:opacity-100 focus-visible:opacity-100"
            onClick={() => {
              useVoiceover.getState().type(lineKey, undefined);
              field.current?.focus();
            }}
          />
        ) : null}
      </div>
      <textarea
        ref={field}
        aria-label={words.lineLabel(number)}
        rows={1}
        maxLength={max}
        readOnly={locked || own.length > max}
        placeholder={typed !== undefined ? words.LINE_GOING : undefined}
        value={typed ?? own}
        className={cn(
          'max-h-40 min-h-[26px] w-full min-w-0 resize-none rounded-[5px] border bg-chrome-field px-2 py-1 text-[13px] leading-4 outline-none [field-sizing:content]',
          'focus:border-[var(--vid-played)] read-only:text-chrome-muted',
          changed ? 'border-[var(--vid-played)]' : 'border-chrome-line',
          going && 'line-through',
        )}
        onFocus={() => {
          focused.current = true;
          useVoiceover.getState().select(number);
        }}
        onBlur={() => {
          focused.current = false;
          useVoiceover.getState().select(null);
        }}
        onChange={(event) => type(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
