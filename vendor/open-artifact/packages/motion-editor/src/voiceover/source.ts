/**
 * The voiceover's lines come from the narration the sound player is given: once a film is ready its score loads at
 * once (no narration yet), then the narration once its takes are decoded, with their waveforms. The lines last heard
 * stay meanwhile, marked not fresh, so the lane does not blink while a changed film reloads.
 */

import { voiceoverLines, type FilmSoundInput } from '@open-artifact/motion-audio';
import { useFilm } from '../stores/film.ts';
import { hasNarrationCode } from './narration-code.ts';
import { useVoiceover } from './store.ts';

/** What the lines become after the sound player took `input`. */
export function takeSoundInput(input: FilmSoundInput): void {
  const { setLines, lines } = useVoiceover.getState();
  if (input.narration !== null) {
    const heard = voiceoverLines(input.narration, input.timeline);
    setLines(heard.length > 0 ? heard : null, true);
    return;
  }
  const film = useFilm.getState().film;
  if (film === null || !hasNarrationCode(film)) setLines(null, false);
  else setLines(lines, false);
}
