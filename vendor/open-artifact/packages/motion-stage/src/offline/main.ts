import type { StageFilm, StageMeta } from '../protocol.ts';
import { injectedAudio } from './audio.ts';
import { OFFLINE_DATA_ID, OFFLINE_RUNTIME_ID, readOfflineData } from './data.ts';
import { mountPlayer } from './player.ts';

/** What a standalone page gives the scripts round it, as `window.film`. */
export interface OfflineFilmHandle {
  data: StageFilm;
  ready: Promise<StageMeta>;
  seek(t: number): void;
  play(): void;
  pause(): void;
}

function fail(why: string): void {
  const note = document.createElement('p');
  note.textContent = 'This film cannot play: ' + why + '.';
  note.style.cssText = 'font:14px/1.4 system-ui,sans-serif;margin:24px;color:#b00020';
  document.body.appendChild(note);
}

function start(): void {
  const dataText = document.getElementById(OFFLINE_DATA_ID)?.textContent ?? null;
  const runtime = document.getElementById(OFFLINE_RUNTIME_ID)?.textContent ?? null;
  if (dataText === null || runtime === null) {
    fail('the page has no film');
    return;
  }
  const film = readOfflineData(dataText);
  if (typeof film === 'string') {
    fail(film);
    return;
  }
  const container = document.getElementById('film') ?? document.body;
  const player = mountPlayer({ container, film: { ...film, mode: 'final' }, runtime, audio: injectedAudio() });
  const handle: OfflineFilmHandle = { data: film, ready: player.ready, seek: player.seek, play: player.play, pause: player.pause };
  Reflect.set(window, 'film', handle);
  // The frame keeps clicks on the picture to itself, so play has a button of its own beside it.
  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText =
    'position:fixed;left:16px;bottom:16px;z-index:1;font:600 14px/1 system-ui,sans-serif;padding:10px 16px;border:0;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;cursor:pointer';
  const label = (): void => {
    button.textContent = player.playing ? 'Pause' : 'Play';
  };
  label();
  button.addEventListener('click', () => {
    player.toggle();
    label();
  });
  player.onChange = label;
  document.body.appendChild(button);
  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' || event.repeat || event.target === button) return;
    event.preventDefault();
    player.toggle();
    label();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
