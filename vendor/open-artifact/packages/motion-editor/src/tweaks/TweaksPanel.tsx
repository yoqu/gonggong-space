import type { ReactElement } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { ChromeButton, Tip, ToolButton } from '@open-artifact/editor-kit/react';
import type { ClockPart } from '@open-artifact/motion-core';
import { useComments } from '../comments/comments.ts';
import { pause, seekTo } from '../engine/actions.ts';
import { recordsWithChanges } from '../engine/records.ts';
import { LayersSection } from '../layers/LayersSection.tsx';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import { TextSection } from '../text/TextSection.tsx';
import { VoiceoverSection } from '../voiceover/VoiceoverSection.tsx';
import { resetAllChanges } from './reset-all.ts';
import { SceneSection } from './SceneSection.tsx';
import { hasScenes, partAt, sceneStep } from './scene-place.ts';
import * as words from './words.ts';

const NO_PARTS: readonly ClockPart[] = [];

function stepScene(parts: readonly ClockPart[], index: number, by: number): void {
  const to = sceneStep(parts, index, by);
  if (to === null) return;
  pause();
  seekTo(to.time);
}

function SceneNavigation({ parts, index }: { parts: readonly ClockPart[]; index: number }): ReactElement {
  const title = useFilm((s) => s.film?.meta?.title ?? '');
  const placed = index >= 0;
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-chrome-line pr-1 pl-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-chrome-fg">{placed ? words.sceneOf(index + 1, parts.length) : words.ON_SCREEN_NOW}</span>
        {title !== '' ? <span className="truncate text-[11px] text-chrome-muted">{title}</span> : null}
      </div>
      {placed ? (
        <>
          <ToolButton label={words.PREVIOUS_SCENE} size="md" disabled={index <= 0} icon={<ChevronLeft />} onClick={() => stepScene(parts, index, -1)} />
          <ToolButton
            label={words.NEXT_SCENE}
            size="md"
            disabled={index >= parts.length - 1}
            icon={<ChevronRight />}
            onClick={() => stepScene(parts, index, 1)}
          />
        </>
      ) : null}
    </div>
  );
}

function ResetAll(): ReactElement | null {
  const shown = useFilm((s) => s.stage === 'ready' && recordsWithChanges(s.records).length > 0);
  const paused = usePlayback((s) => !s.playing);
  const writable = useWorking((s) => s.readOnlyReason === null);
  const agent = useWorking((s) => s.name);
  if (!shown || !paused || !writable) return null;
  return (
    <div className="flex px-3 py-3">
      <Tip label={words.resetAllTip(agent)} side="top">
        <ChromeButton onClick={() => void resetAllChanges()}>
          <RotateCcw className="size-4" />
          {words.RESET_ALL}
        </ChromeButton>
      </Tip>
    </div>
  );
}

/** Tweaks: the scene on show (name, length, pace), its text, its layers, the voiceover, and a way to take it all back. */
export function TweaksPanel(): ReactElement {
  const parts = useFilm((s) => s.clock?.parts ?? NO_PARTS);
  const sceneFile = useFilm((s) => s.scenes !== null);
  const scenes = hasScenes(parts.length, sceneFile);
  const index = usePlayback((s) => (scenes ? partAt(parts, s.time) : -1));
  const playing = usePlayback((s) => s.playing);
  const commentsOn = useComments((s) => s.on);
  const writable = useWorking((s) => s.readOnlyReason === null);
  return (
    <div className="flex min-h-full flex-col" data-video-tweaks="">
      <SceneNavigation parts={parts} index={index} />
      {index >= 0 && !commentsOn && writable ? <SceneSection parts={parts} index={index} off={playing} /> : null}
      <TextSection />
      <LayersSection />
      <VoiceoverSection />
      <ResetAll />
    </div>
  );
}
