import { encodePcmWave } from './wave.ts';

/**
 * On iPhone and iPad, WebAudio follows the ring/silent switch unless a media element plays too. A looped half second of
 * silence in an audio element, playing while sound should be heard and the page is in view, keeps the film audible.
 */
export interface AudioKeepalive {
  set(audible: boolean): void;
  dispose(): void;
}

export function isAppleTouchDevice(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  );
}

export function createAudioKeepalive(context: BaseAudioContext): AudioKeepalive | null {
  if (!isAppleTouchDevice() || typeof Audio === 'undefined' || typeof document === 'undefined') return null;
  let element: HTMLAudioElement | null = null;
  let url = '';
  let wanted = false;
  const elementFor = (): HTMLAudioElement => {
    if (element !== null) return element;
    const silence = context.createBuffer(1, Math.round(context.sampleRate / 2), context.sampleRate);
    url = URL.createObjectURL(new Blob([encodePcmWave(silence)], { type: 'audio/wav' }));
    element = new Audio(url);
    element.loop = true;
    element.disableRemotePlayback = true;
    return element;
  };
  const update = (): void => {
    if (wanted && !document.hidden) {
      const playing = elementFor();
      if (playing.paused) playing.play().catch(() => undefined);
    } else if (element !== null && !element.paused) element.pause();
  };
  document.addEventListener('visibilitychange', update);
  return {
    set(audible) {
      wanted = audible;
      update();
    },
    dispose() {
      document.removeEventListener('visibilitychange', update);
      wanted = false;
      if (element === null) return;
      element.pause();
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(url);
      element = null;
    },
  };
}
