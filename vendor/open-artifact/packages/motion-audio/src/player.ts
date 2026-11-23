import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds } from '@open-artifact/motion-core';
import { createAudioKeepalive } from './keepalive.ts';
import type { AudioKeepalive } from './keepalive.ts';
import { createMasterBus } from './mixer.ts';
import type { MasterBus } from './mixer.ts';
import { filmSound, knownScoreGain, measureScoreGain } from './offline.ts';
import type { FilmSound, FilmSoundInput } from './offline.ts';
import { playScore } from './played-score.ts';
import type { PlayedScore } from './played-score.ts';
import { audioClockSource, createVisibleClock, wallClockSource } from './playback-clock.ts';
import type { PlaybackTimeSource, VisibleClock } from './playback-clock.ts';
import { startScorePass } from './scheduler.ts';
import type { ScorePass, SchedulerTimers } from './scheduler.ts';
import { identityTimeline } from './timeline.ts';

export interface SoundPlayerState {
  /** An audio context exists and is not closed: sound can be heard. */
  readonly available: boolean;
  readonly playing: boolean;
  readonly muted: boolean;
  /** 0…1. */
  readonly volume: number;
  /** Play seconds per second. */
  readonly rate: number;
  /** The system cut the sound off while playing; the page should pause. */
  readonly interrupted: boolean;
}

export interface FilmSoundPlayerOptions {
  /** Makes the page's audio context; by default a 48 kHz interactive AudioContext. Null: no audio here. */
  readonly createContext?: () => AudioContext | null;
  readonly timers?: SchedulerTimers;
  readonly clock?: VisibleClock;
}

const VOLUME_SMOOTHING_SECONDS = 0.015;
const NORMALIZATION_SMOOTHING_SECONDS = 0.15;
const LEAST_RATE = 0.1;
const MOST_RATE = 16;

function pageAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    return new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  } catch {
    try {
      return new AudioContext();
    } catch {
      return null;
    }
  }
}

/**
 * The film's sound in the editor: the score synthesized live and the narration over it, in step with the picture.
 * Starts with the sound on; it is heard from the first click or key press that plays the film, which is when a
 * browser lets audio start. The page reads `now()` every frame while playing, so the picture follows the sound.
 */
export class FilmSoundPlayer {
  readonly #createContext: () => AudioContext | null;
  readonly #timers: SchedulerTimers | undefined;
  readonly #clock: VisibleClock;
  readonly #listeners = new Set<(state: SoundPlayerState) => void>();
  #context: AudioContext | null = null;
  #master: MasterBus | null = null;
  #keepalive: AudioKeepalive | null = null;
  #sound: FilmSound = { score: playScore(null, identityTimeline(filmSeconds(0))), speech: null };
  #pass: ScorePass | null = null;
  #source: PlaybackTimeSource | null = null;
  #position: PlaySeconds = playSeconds(0);
  #pendingGains = new WeakSet<PlayedScore>();
  #state: SoundPlayerState = { available: false, playing: false, muted: false, volume: 1, rate: 1, interrupted: false };

  constructor(options: FilmSoundPlayerOptions = {}) {
    this.#createContext = options.createContext ?? pageAudioContext;
    this.#timers = options.timers;
    this.#clock = options.clock ?? createVisibleClock();
  }

  get state(): SoundPlayerState {
    return this.#state;
  }

  /** The film's sound as last loaded, in play time: what an export renders. */
  get sound(): FilmSound {
    return this.#sound;
  }

  subscribe(listener: (state: SoundPlayerState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Takes a new score, narration or timeline; playing on from where the playhead is. */
  load(input: FilmSoundInput): void {
    this.#sound = filmSound(input);
    this.#prepareGain(this.#sound.score);
    this.#applyGain(false);
    if (this.#state.playing) this.#restart(this.now());
    this.#update({});
  }

  /** Makes or wakes the audio context; call from a click or key press, which browsers require for sound. */
  prime(): void {
    const hadContext = this.#context !== null;
    const context = this.#ensureContext();
    if (context === null) return;
    this.#resume(context);
    // Playing on the visible clock until now: the sound joins where the picture is.
    if (!hadContext && this.#state.playing) this.#restart(this.now());
  }

  play(from: PlaySeconds): void {
    this.#restart(from);
    this.#update({ playing: true, interrupted: false });
  }

  pause(): void {
    this.#position = this.now();
    this.#stopPass();
    this.#update({ playing: false });
  }

  seek(to: PlaySeconds): void {
    this.#position = to;
    if (this.#state.playing) this.#restart(to);
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const bounded = Math.max(LEAST_RATE, Math.min(MOST_RATE, rate));
    if (bounded === this.#state.rate) return;
    const at = this.now();
    this.#update({ rate: bounded });
    if (this.#state.playing) this.#restart(at);
  }

  setMuted(muted: boolean): void {
    this.#update({ muted });
    if (!muted) this.prime();
    this.#applyVolume();
  }

  setVolume(volume: number): void {
    this.#update({ volume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1)) });
    this.#applyVolume();
  }

  /** Where the playhead is: from the audio context while it moves, else from the visible clock. */
  now(): PlaySeconds {
    if (!this.#state.playing || this.#source === null) return this.#position;
    const at = this.#source.now();
    if (this.#source.interrupted() && !this.#state.interrupted) {
      this.#position = at;
      this.#stopPass();
      this.#update({ playing: false, interrupted: true });
    }
    return at;
  }

  dispose(): void {
    this.#stopPass();
    this.#keepalive?.dispose();
    this.#keepalive = null;
    this.#clock.dispose();
    this.#context?.close().catch(() => undefined);
    this.#context = null;
    this.#master = null;
    this.#listeners.clear();
  }

  #update(change: Partial<SoundPlayerState>): void {
    const available = this.#context !== null && this.#master !== null && this.#context.state !== 'closed';
    const next = { ...this.#state, ...change, available };
    const changed = (Object.keys(next) as (keyof SoundPlayerState)[]).some((key) => next[key] !== this.#state[key]);
    this.#state = next;
    this.#keepalive?.set(this.#audible());
    if (changed) for (const listener of this.#listeners) listener(next);
  }

  #audible(): boolean {
    const { playing, muted, volume } = this.#state;
    return playing && !muted && volume > 0 && (this.#sound.score.sounds.length > 0 || this.#sound.speech !== null);
  }

  #ensureContext(): AudioContext | null {
    if (this.#context !== null) return this.#context;
    const context = this.#createContext();
    if (context === null) return null;
    this.#context = context;
    this.#master = createMasterBus(context);
    this.#master.output.gain.value = this.#state.muted ? 0 : this.#state.volume;
    this.#keepalive = createAudioKeepalive(context);
    this.#applyGain(false);
    this.#update({});
    return context;
  }

  #resume(context: AudioContext): void {
    if (context.state !== 'running' && context.state !== 'closed') context.resume().catch(() => undefined);
  }

  #applyVolume(): void {
    if (this.#master === null || this.#context === null) return;
    const { muted, volume } = this.#state;
    this.#master.output.gain.setTargetAtTime(muted ? 0 : volume, this.#context.currentTime, VOLUME_SMOOTHING_SECONDS);
  }

  #prepareGain(score: PlayedScore): void {
    if (knownScoreGain(score) !== undefined || this.#pendingGains.has(score) || typeof OfflineAudioContext === 'undefined') return;
    this.#pendingGains.add(score);
    measureScoreGain(score)
      .catch(() => 1)
      .then(() => {
        this.#pendingGains.delete(score);
        if (this.#sound.score === score) this.#applyGain(true);
      });
  }

  #applyGain(smoothly: boolean): void {
    if (this.#master === null || this.#context === null) return;
    const gain = knownScoreGain(this.#sound.score) ?? 1;
    if (smoothly) this.#master.normalization.gain.setTargetAtTime(gain, this.#context.currentTime, NORMALIZATION_SMOOTHING_SECONDS);
    else this.#master.normalization.gain.value = gain;
  }

  #restart(from: PlaySeconds): void {
    this.#stopPass();
    this.#position = from;
    const { rate } = this.#state;
    const context = this.#context;
    const master = this.#master;
    if (context === null || master === null || context.state === 'closed') {
      this.#source = wallClockSource(from, rate, this.#clock);
      return;
    }
    this.#resume(context);
    this.#applyGain(false);
    const pass = this.#startPass(master, from);
    this.#source = audioClockSource({
      context,
      clock: this.#clock,
      from,
      rate,
      origin: () => this.#pass?.session.origin ?? pass.session.origin,
      audible: () => this.#audible(),
      onStall: () => this.#pass?.stop(),
      onResume: (at) => {
        if (this.#pass === null || this.#state.rate !== rate) return;
        this.#pass.stop();
        this.#pass = this.#startPass(master, at);
      },
    });
  }

  #startPass(master: MasterBus, from: PlaySeconds): ScorePass {
    const pass = startScorePass({ master, sound: this.#sound, from, rate: this.#state.rate, timers: this.#timers });
    this.#pass = pass;
    return pass;
  }

  #stopPass(): void {
    this.#pass?.stop();
    this.#pass = null;
    this.#source = null;
  }
}
