import type { ReactElement } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { SliderInput } from '@open-artifact/ui';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { setVolume, toggleMuted } from '../engine/actions.ts';
import { usePlayback } from '../stores/playback.ts';
import * as words from './words.ts';

/** Mute (M) and, on hover or focus, the volume slider. Hidden when the film has no sound. */
export function VolumeControl(): ReactElement | null {
  const available = usePlayback((s) => s.soundAvailable);
  const muted = usePlayback((s) => s.muted);
  const volume = usePlayback((s) => s.volume);
  if (!available) return null;
  const silent = muted || volume === 0;
  const icon = silent ? <VolumeX /> : volume < 0.5 ? <Volume1 /> : <Volume2 />;
  return (
    <div className="group flex items-center">
      <ToolButton label={silent ? words.UNMUTE : words.MUTE} shortcut="M" size="lg" icon={icon} onClick={toggleMuted} />
      <div className="w-0 overflow-hidden opacity-0 transition-[width,opacity] group-focus-within:w-24 group-focus-within:opacity-100 group-hover:w-24 group-hover:opacity-100">
        <div className="w-20 px-1">
          <SliderInput value={silent ? 0 : Math.round(volume * 100)} min={0} max={100} aria-label={words.VOLUME} onChange={(value) => setVolume(value / 100)} />
        </div>
      </div>
    </div>
  );
}
