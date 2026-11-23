import type { ReactElement } from 'react';
import { RotateCcw } from 'lucide-react';
import { ChromeButton, Tip, ToolButton } from '@open-artifact/editor-kit/react';
import { CommitInput, ScrubNumberField, Section } from '@open-artifact/ui';
import { EMPTY_RECUT_RECORD, MAX_SCENE_NAME_CHARS, SCENE_DURATION_STEP, partRecut, type ClockPart } from '@open-artifact/motion-core';
import { setSceneLength, setSceneName } from '../recut/actions.ts';
import { roundTenths, scaledSceneLength, sceneLengthBounds, stableSceneKey } from '../recut/bounds.ts';
import { useFilm } from '../stores/film.ts';
import { PanelRow } from './PanelSection.tsx';
import * as words from './words.ts';

function Reset({ label, shown, off, onReset }: { label: string; shown: boolean; off: boolean; onReset: () => void }): ReactElement {
  if (!shown) return <span className="size-8 shrink-0" />;
  return <ToolButton label={label} tipSide="left" size="md" disabled={off} icon={<RotateCcw />} onClick={onReset} />;
}

function SpeedButton({ text, tip, length, off }: { text: string; tip: string; length: (() => void) | null; off: boolean }): ReactElement {
  return (
    <Tip label={tip} side="top">
      <ChromeButton className="tabular-nums" aria-label={tip} disabled={off || length === null} onClick={length ?? undefined}>
        {text}
      </ChromeButton>
    </Tip>
  );
}

/** The scene on show: its name, how long it plays, and its pace. `off` while the film plays. */
export function SceneSection({ parts, index, off }: { parts: readonly ClockPart[]; index: number; off: boolean }): ReactElement | null {
  const recut = useFilm((s) => s.records.recut);
  const part = parts[index];
  const bounds = sceneLengthBounds(parts, index);
  if (part === undefined || bounds === null) return null;
  const byHand = partRecut(recut ?? EMPTY_RECUT_RECORD, parts, index);
  const key = stableSceneKey(part, index);
  const at = (speed: number): (() => void) | null => {
    const length = scaledSceneLength(bounds, part.playDur, speed);
    return length === null ? null : () => void setSceneLength(index, length);
  };
  const slower = at(0.5);
  const faster = at(2);
  return (
    <Section title={words.SCENE}>
      <PanelRow label={words.NAME}>
        <CommitInput
          key={key}
          aria-label={words.NAME}
          value={part.label}
          maxLength={MAX_SCENE_NAME_CHARS}
          disabled={off}
          className="min-w-0 flex-1"
          onCommit={(name) => setSceneName(index, name.trim() === '' ? null : name)}
        />
        <Reset label={words.RESET_NAME} shown={byHand.name !== null} off={off} onReset={() => setSceneName(index, null)} />
      </PanelRow>
      <PanelRow label={words.LENGTH}>
        <ScrubNumberField
          key={key}
          aria-label={words.LENGTH}
          className="min-w-0 flex-1"
          value={roundTenths(part.playDur)}
          unit={words.SECONDS_UNIT}
          step={SCENE_DURATION_STEP}
          largeStep={1}
          precision={1}
          min={bounds.min}
          max={bounds.max}
          disabled={off}
          onCommit={(seconds) => void setSceneLength(index, seconds)}
        />
        <Reset label={words.RESET_LENGTH} shown={byHand.dur !== null} off={off} onReset={() => void setSceneLength(index, null)} />
      </PanelRow>
      <PanelRow label={words.SPEED}>
        <SpeedButton text={words.HALF_SPEED_MARK} tip={slower === null ? words.CANT_GO_SLOWER : words.HALF_SPEED} length={slower} off={off} />
        <SpeedButton text={words.DOUBLE_SPEED_MARK} tip={faster === null ? words.CANT_GO_FASTER : words.DOUBLE_SPEED} length={faster} off={off} />
      </PanelRow>
    </Section>
  );
}
