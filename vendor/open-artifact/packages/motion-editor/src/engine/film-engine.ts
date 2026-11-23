/**
 * The film engine, free of React: follows the live film, decodes it (debounced), loads it on the stage, keeps the
 * playhead and the sound in step, and writes what it learns to the film and playback stores. The page talks to it
 * through `actions.ts`; later parts of the page listen to the stage through {@link FilmEngine.onStageMessage}.
 *
 * A film that cannot load with a person's retyped lines or colors is tried again with less (`filmTries`), and
 * `useCameUp` says which try is on show.
 */

import { FilmSoundPlayer, type FilmSoundInput } from '@open-artifact/motion-audio';
import {
  buildClock,
  decodeFilm,
  filmSeconds,
  paletteFallback,
  type Film,
  type FilmRecordsHeld,
  type MissingFont,
  type PlaySeconds,
} from '@open-artifact/motion-core';
import type { HostToStage, RenderMode, StageFilm, StageMeta, StageToHost } from '@open-artifact/motion-stage';
import { toast } from '@open-artifact/ui';
import type { FilmSource } from '../host/live-film.ts';
import { addConsoleLine, useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { applyFilmRecords, failedTryNote, filmTryCodes, recordsHeld, type FilmTryCode } from './applied-film.ts';
import { useCameUp } from './came-up.ts';
import { filmStageFaces, type FilmFontsIo } from './film-faces.ts';
import { PlaybackLoop } from './playback-loop.ts';
import { readFilmRecords, type FilmRecords } from './records.ts';
import { loadFilmSound } from './sound.ts';
import { StageController, type FrameMessage, type ReadyMessage } from './stage-controller.ts';
import { buildStageFilm, stageKey, stageModules, type AssetReader } from './stage-film.ts';
import { ThumbnailCache } from './thumbnails.ts';
import { SOUND_FAILED, STAGE_TITLE } from './words.ts';

export const DECODE_DEBOUNCE_MS = 250;

export interface FilmEngineOptions {
  runtime: string;
  source: FilmSource;
  assets: AssetReader;
  /** Typefaces: without it the film is in the system's fonts. */
  fonts?: FilmFontsIo;
  debounceMs?: number;
}

export function clockFromMeta(meta: StageMeta, records: FilmRecords): ReturnType<typeof buildClock> {
  return buildClock(
    meta.parts.map((part) => ({ key: part.key, name: part.own, dur: filmSeconds(part.nat) })),
    records.recut,
  );
}

/** A film the engine built for the stage, with the Google families it asks for that could not be had. */
export interface FilmLoad {
  stageFilm: StageFilm;
  missingFonts: readonly MissingFont[];
}

function tell<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) listener(value);
}

/** A film's loads to try in turn, and the one on the stage now. */
interface FilmTrying {
  held: FilmRecordsHeld;
  tries: { code: FilmTryCode; stageFilm: StageFilm }[];
  at: number;
  revision: number;
}

export class FilmEngine {
  readonly stage: StageController;
  readonly sound = new FilmSoundPlayer();
  readonly playback: PlaybackLoop;
  readonly thumbnails: ThumbnailCache;
  readonly #source: FilmSource;
  readonly #assets: AssetReader;
  readonly #fonts: FilmFontsIo | undefined;
  readonly #debounceMs: number;
  readonly #stageListeners = new Set<(message: StageToHost) => void>();
  readonly #loadListeners = new Set<(load: FilmLoad) => void>();
  readonly #soundListeners = new Set<(input: FilmSoundInput) => void>();
  #film: Film | null = null;
  #stageFilm: StageFilm | null = null;
  #holds = 0;
  #heldTrying: FilmTrying | null = null;
  #trying: FilmTrying | null = null;
  #key: string | null = null;
  #mode: RenderMode = 'rough';
  #loadToken = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stops: (() => void)[] = [];

  constructor(options: FilmEngineOptions) {
    this.#source = options.source;
    this.#assets = options.assets;
    this.#fonts = options.fonts;
    this.#debounceMs = options.debounceMs ?? DECODE_DEBOUNCE_MS;
    this.thumbnails = new ThumbnailCache(options.runtime);
    this.stage = new StageController({
      runtime: options.runtime,
      title: STAGE_TITLE,
      events: {
        ready: (message) => this.#ready(message),
        presented: (seq) => this.playback.presented(seq),
        error: (phase, message, stack) => {
          const at = phase === 'render' ? this.playback.time : null;
          this.playback.halt();
          useFilm.setState({ stage: phase === 'load' ? 'error' : useFilm.getState().stage, stageProblem: { phase, message, stack, at } });
        },
        console: (level, text) => addConsoleLine({ level, text }),
        link: (href) => openLink(href),
        other: (message) => tell(this.#stageListeners, message),
      },
    });
    this.playback = new PlaybackLoop({
      stage: this.stage,
      sound: this.sound,
      duration: () => useFilm.getState().meta?.duration ?? 0,
      onTick: (tick) => usePlayback.setState(tick),
    });
  }

  start(): void {
    this.#stops.push(this.#source.subscribe(() => this.#schedule()));
    this.#stops.push(
      this.sound.subscribe((state) =>
        usePlayback.setState({ muted: state.muted, volume: state.volume, rate: state.rate, soundAvailable: state.available }),
      ),
    );
    const { loop, volume } = usePlayback.getState();
    this.playback.setLoop(loop);
    this.sound.setVolume(volume);
    if (this.#source.loaded()) this.#decode();
  }

  /** Mounts the stage's frames in the player. */
  attach(container: HTMLElement): void {
    this.stage.attach(container);
  }

  detach(container: HTMLElement): void {
    this.stage.detach(container);
  }

  /** rough: rough scenes draw as sketches; final: every written scene draws as it is. */
  setMode(mode: RenderMode): void {
    this.#mode = mode;
    this.stage.setMode(mode);
  }

  /** Sends the stage a message (layers, look, watch…); it reaches the film on show only. */
  send(message: HostToStage): void {
    this.stage.send(message);
  }

  /** Listens to what the stage says beyond playback (`texts`, `layers`, `looked`, `frame-error`). */
  onStageMessage(listener: (message: StageToHost) => void): () => void {
    this.#stageListeners.add(listener);
    return () => void this.#stageListeners.delete(listener);
  }

  /** Hears each film built for the stage (held back or not), as it is built. */
  onFilmLoad(listener: (load: FilmLoad) => void): () => void {
    this.#loadListeners.add(listener);
    return () => void this.#loadListeners.delete(listener);
  }

  /** Hears what the sound player is given: the score once a film is ready, then the narration once decoded. */
  onSoundLoad(listener: (input: FilmSoundInput) => void): () => void {
    this.#soundListeners.add(listener);
    return () => void this.#soundListeners.delete(listener);
  }

  /** The film last built for the stage, or `null` before one was. */
  get stageFilm(): StageFilm | null {
    return this.#stageFilm;
  }

  /**
   * Keeps new films off the stage until every hold is let go; the newest built meanwhile loads then. The function
   * returned lets go, and says whether that loaded a film.
   */
  holdLoads(): () => boolean {
    this.#holds += 1;
    let released = false;
    return () => {
      if (released) return false;
      released = true;
      this.#holds -= 1;
      const held = this.#holds === 0 ? this.#heldTrying : null;
      if (held === null) return false;
      this.#heldTrying = null;
      this.#loadTry(held);
      return true;
    };
  }

  /** Some hold from {@link holdLoads} is still on. */
  get holdsLoads(): boolean {
    return this.#holds > 0;
  }

  pullFrame(t: PlaySeconds, scale: number): Promise<FrameMessage> {
    return this.stage.pullFrame({ t, scale, smallMedia: false, readFx: true, smooth: true });
  }

  /** Loads the film again from the store, as if it had changed. */
  reload(): void {
    this.#key = null;
    this.#decode();
  }

  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    for (const stop of this.#stops.reverse()) stop();
    this.#stops = [];
    this.playback.dispose();
    this.stage.dispose();
    this.thumbnails.dispose();
    this.sound.dispose();
  }

  #schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#decode();
    }, this.#debounceMs);
  }

  #decode(): void {
    const film = decodeFilm(this.#source.documents());
    const records = readFilmRecords(film);
    const hasScript = film.script.trim() !== '';
    // Before the stores tell of it: a reading of the layers they set off is of the film with the record laid.
    this.stage.retouch(records.retouched);
    useFilm.setState({
      film,
      problems: film.problems,
      hasScript,
      scenes: film.scenes?.ok === true ? film.scenes.file : null,
      records,
    });
    this.#film = film;
    if (!hasScript) {
      this.#key = null;
      this.playback.halt();
      useFilm.setState({ stage: 'idle', meta: null, clock: null, stageProblem: null });
      return;
    }
    const key = stageKey(film);
    if (key === this.#key) {
      const meta = useFilm.getState().meta;
      if (meta !== null) useFilm.setState({ clock: clockFromMeta(meta, records) });
      return;
    }
    this.#key = key;
    void this.#load(film);
  }

  /** Loads the film with a person's records applied (retyped, recolored, refaced and fetched fonts) and its faces. */
  async #load(film: Film): Promise<void> {
    const token = ++this.#loadToken;
    const records = readFilmRecords(film);
    const applied = applyFilmRecords(film, records);
    const fonts = this.#fonts === undefined ? null : await filmStageFaces(applied.script, applied.modules, this.#fonts);
    if (token !== this.#loadToken) return;
    const { stageFilm, missing } = await buildStageFilm(film, { script: applied.script, modules: applied.modules, faces: fonts?.faces ?? null }, this.#mode, this.#assets);
    if (token !== this.#loadToken) return;
    for (const text of [...applied.warnings, ...(fonts?.warnings ?? [])]) addConsoleLine({ level: 'warn', text });
    for (const text of fonts?.infos ?? []) addConsoleLine({ level: 'info', text });
    // Families that came late load the film again, once, in their own faces.
    void fonts?.prepared?.late?.then((came) => {
      if (token === this.#loadToken && came.size > 0) this.reload();
    });
    for (const name of missing) addConsoleLine({ level: 'warn', text: `The asset ${name} could not be loaded.` });
    const revision = useFilm.getState().revision + 1;
    // The film on show keeps playing while the new one loads; anything else gives way to the loading state.
    useFilm.setState((state) => ({ revision, stage: state.stage === 'ready' ? 'ready' : 'loading' }));
    this.thumbnails.setFilm(stageFilm, revision);
    this.#stageFilm = stageFilm;
    tell(this.#loadListeners, { stageFilm, missingFonts: fonts?.prepared?.absent ?? [] });
    const tries = filmTryCodes(film, records, applied).map((code, index) => ({
      code,
      stageFilm: index === 0 ? stageFilm : { ...stageFilm, script: code.script, modules: stageModules(code) },
    }));
    const trying: FilmTrying = { held: recordsHeld(applied), tries, at: 0, revision };
    if (this.#holds > 0) this.#heldTrying = trying;
    else this.#loadTry(trying);
  }

  /** Loads the film's try on show in `trying`; when it fails to load, the next try is loaded in its place. */
  #loadTry(trying: FilmTrying): void {
    const tried = trying.tries[trying.at];
    if (tried === undefined) return;
    this.#trying = trying;
    const next = trying.tries[trying.at + 1];
    if (next === undefined) return this.stage.load(tried.stageFilm);
    this.stage.load(tried.stageFilm, (_phase, message, stack) => {
      if (this.#trying !== trying || trying.tries[trying.at] !== tried) return false;
      addConsoleLine({ level: 'error', text: stack === '' ? message : `${message}\n${stack}` });
      addConsoleLine({ level: 'warn', text: failedTryNote(tried.code, next.code) });
      trying.at += 1;
      this.#loadTry(trying);
      return true;
    });
  }

  #ready(message: ReadyMessage): void {
    this.#cameUp();
    const { records } = useFilm.getState();
    // The frame took the record as it came up (StageController.retouch), ahead of what this sets off.
    useFilm.setState({ stage: 'ready', meta: message.meta, clock: clockFromMeta(message.meta, records), stageProblem: null, loadMs: message.loadMs });
    this.playback.stageReady();
    const token = this.#loadToken;
    const film = this.#film;
    const give = (input: FilmSoundInput): void => {
      this.sound.load(input);
      tell(this.#soundListeners, input);
    };
    loadFilmSound(give, message, {
      isCurrent: () => token === this.#loadToken,
      assets: film?.assets ?? [],
      bytes: (ref) => this.#assets.bytes(ref),
    }).catch((error: unknown) => {
      console.warn('video: the sound could not be prepared', error);
      toast.add({ title: SOUND_FAILED });
    });
  }

  /** Says which try came up; a later try is the film the stills and frames are taken of from now on. */
  #cameUp(): void {
    const trying = this.#trying;
    const tried = trying?.tries[trying.at];
    if (trying === null || tried === undefined) return;
    if (trying.at > 0 && this.#stageFilm !== tried.stageFilm) {
      this.#stageFilm = tried.stageFilm;
      this.thumbnails.setFilm(tried.stageFilm, trying.revision);
    }
    useCameUp.setState({ revision: trying.revision, ...paletteFallback(trying.held, tried.code) });
  }
}

/** Opens a link the film's viewer clicked: web links only, in a new tab, never in this page. */
export function openLink(href: string): void {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  window.open(url.href, '_blank', 'noopener,noreferrer');
}
