import type { ReactElement } from 'react';
import { Maximize, Minimize, Pause, Play, Repeat, SkipBack } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { restart, setLoop, togglePlay } from '../engine/actions.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { fullscreenAvailable, toggleFullscreen } from './fullscreen.ts';
import { useToolbar } from './slots.ts';
import { TimeDisplay } from './TimeDisplay.tsx';
import { VolumeControl } from './VolumeControl.tsx';
import * as words from './words.ts';

/** The bottom toolbar: play, back to the start, time, loop and sound; added buttons; full screen. */
export function Transport(): ReactElement {
  const playing = usePlayback((s) => s.playing);
  const loop = usePlayback((s) => s.loop);
  const ready = useFilm((s) => s.stage === 'ready');
  const fullscreen = useUi((s) => s.fullscreen);
  const items = useToolbar((s) => s.items);
  const canFullscreen = fullscreenAvailable();
  return (
    <div role="toolbar" aria-label={words.PLAYBACK} className="@container flex h-12 shrink-0 items-center gap-0.5 px-2" data-video-transport="">
      <ToolButton
        label={playing ? words.PAUSE : ready ? words.PLAY : words.NO_ANIMATION_TO_PLAY}
        shortcut="Space"
        size="lg"
        disabled={!ready}
        icon={playing ? <Pause /> : <Play />}
        onClick={togglePlay}
      />
      <ToolButton label={words.BACK_TO_START} shortcut="Home" size="lg" className="@max-[26rem]:hidden" disabled={!ready} icon={<SkipBack />} onClick={restart} />
      <TimeDisplay />
      <ToolButton label={words.LOOP} size="lg" pressed={loop} icon={<Repeat />} onClick={() => setLoop(!loop)} />
      <VolumeControl />
      {items
        .filter((item) => item.side === 'start')
        .map((item) => (
          <span key={item.id} className="contents">
            {item.render()}
          </span>
        ))}
      <span className="flex-1" />
      {items
        .filter((item) => item.side === 'end')
        .map((item) => (
          <span key={item.id} className="contents">
            {item.render()}
          </span>
        ))}
      <ToolButton
        label={!canFullscreen ? words.FULL_SCREEN_UNAVAILABLE : fullscreen ? words.EXIT_FULL_SCREEN : words.FULL_SCREEN}
        shortcut="F"
        size="lg"
        disabled={!canFullscreen}
        icon={fullscreen ? <Minimize /> : <Maximize />}
        onClick={toggleFullscreen}
      />
    </div>
  );
}
