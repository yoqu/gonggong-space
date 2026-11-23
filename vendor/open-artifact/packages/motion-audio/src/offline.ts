import { playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds, ScoreData } from '@open-artifact/motion-core';
import { loudnessGain, measureIntegratedLoudness } from './loudness.ts';
import type { LoudnessMeasurement } from './loudness.ts';
import { createMasterBus } from './mixer.ts';
import { placeSpeech } from './narration/speech.ts';
import type { DecodedNarration, Speech, SpeechClip } from './narration/speech.ts';
import { playScore } from './played-score.ts';
import type { PlayedScore } from './played-score.ts';
import { createScoreSession } from './session.ts';
import type { VoiceBus } from './synth/nodes.ts';
import { scheduleSound } from './synth/schedule.ts';
import type { FilmTimeline } from './timeline.ts';
import { heardFrom } from './window.ts';
import type { HeardSpan } from './window.ts';

/** Everything a film sounds: its score and its narration, both in play time. */
export interface FilmSound {
  readonly score: PlayedScore;
  readonly speech: Speech | null;
}

/** A film's sound as recorded: the score and decoded narration in film time, and how film time is played. */
export interface FilmSoundInput {
  readonly score: ScoreData | null;
  readonly narration: DecodedNarration | null;
  readonly timeline: FilmTimeline;
}

/** Places the score and the narration in play time. */
export function filmSound(input: FilmSoundInput): FilmSound {
  return { score: playScore(input.score, input.timeline), speech: placeSpeech(input.narration, input.timeline) };
}

export interface FilmAudioRender extends LoudnessMeasurement {
  readonly buffer: AudioBuffer;
  /** Sounds scheduled. */
  readonly voices: number;
  /** Milliseconds the render took. */
  readonly ms: number;
  /** The score's loudness before normalization. */
  readonly lufsRaw: number;
  /** The normalization gain applied to the score. */
  readonly gain: number;
}

export interface RenderOptions {
  readonly sampleRate?: number;
  /** Seconds rendered past the film's end. */
  readonly tail?: number;
}

export const DEFAULT_SAMPLE_RATE = 48000;
/** Rendered ahead of play time 0 and dropped, so a sound heard before its onset (a reverse swell) is whole. */
export const OFFLINE_PREROLL_SECONDS = 0.3;
/** Narration's loudness is measured on its first minute of takes. */
export const SPEECH_MEASURE_SECONDS = 60;
/** A normalization this close to unity is not worth a second render. */
const UNITY_TOLERANCE_DB = 0.5;
/** A score renders a stretch at a time: the context stops this often, in context seconds, for the next sounds. */
export const OFFLINE_RENDER_CHUNK_SECONDS = 2;
/** A chunked render that reaches no stop for this long is given up and the score rendered whole. */
export const OFFLINE_CHUNK_STALL_MS = 30_000;

function offlineContext(channels: number, frames: number, sampleRate: number): OfflineAudioContext {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('This browser cannot render audio offline.');
  return new OfflineAudioContext(channels, frames, sampleRate);
}

/** What a chunked render uses of its context. */
export type ChunkedContext = Pick<OfflineAudioContext, 'currentTime' | 'length' | 'sampleRate' | 'createGain' | 'suspend' | 'resume' | 'startRendering'>;

/** Builds sound `index` on `bus`; false when nothing was built. */
export type ScheduleHeard = (bus: VoiceBus, index: number) => boolean;

/** A finished render and the sounds scheduled for it. */
export interface RenderedPass {
  readonly rendered: AudioBuffer;
  readonly voices: number;
}

/** A stretch's own pair of sends into the session's, let go once its sounds have ended. */
interface StretchGains {
  readonly dry: GainNode;
  readonly reverb: GainNode;
  /** Its sources that have not ended. */
  sounding: number;
  /** Silent at the stop before: let go at the next. */
  quiet: boolean;
}

/** Every sound heard from play time 0 scheduled up front, then the whole render. */
async function renderWhole(context: OfflineAudioContext, bus: VoiceBus, sounds: readonly HeardSpan[], schedule: ScheduleHeard): Promise<RenderedPass> {
  let voices = 0;
  for (const index of heardFrom(sounds, playSeconds(0))) if (schedule(bus, index)) voices++;
  return { rendered: await context.startRendering(), voices };
}

/**
 * Renders the sounds a stretch at a time, so a long score never holds the nodes of all its sounds at once. The context
 * stops every {@link OFFLINE_RENDER_CHUNK_SECONDS}; at each stop the sounds heard from before the stop after next are
 * built on a fresh pair of gains, which count their sources, and a pair silent at two stops in a row is let go; the
 * last stretch takes every sound left. `sounds` come ordered by start, `contextTime` gives a play time's context time.
 * Null when the render must be done whole instead: a stop came more than half a stretch late, none came for
 * {@link OFFLINE_CHUNK_STALL_MS}, or sounds were left unscheduled at the end.
 */
export function renderInChunks(
  context: ChunkedContext,
  bus: VoiceBus,
  sounds: readonly HeardSpan[],
  contextTime: (play: number) => number,
  schedule: ScheduleHeard,
): Promise<RenderedPass | null> {
  const heard = heardFrom(sounds, playSeconds(0));
  const length = context.length / context.sampleRate;
  // The stretches' gains come and go: the sends stay stereo whatever is connected to them.
  for (const send of [bus.dry, bus.reverb]) {
    send.channelCount = 2;
    send.channelCountMode = 'explicit';
  }
  let stretches: StretchGains[] = [];
  let next = 0;
  let voices = 0;
  let stall: ReturnType<typeof setTimeout> | undefined;
  let giveUp = (): void => {};
  const gaveUp = new Promise<null>((resolve) => {
    giveUp = () => resolve(null);
  });

  const scheduleStretch = (from: number): void => {
    if (context.currentTime > from + OFFLINE_RENDER_CHUNK_SECONDS / 2) throw new Error('the render stopped too late for the next sounds');
    clearTimeout(stall);
    stall = setTimeout(giveUp, OFFLINE_CHUNK_STALL_MS);
    for (const stretch of stretches) {
      if (!stretch.quiet) continue;
      stretch.dry.disconnect();
      stretch.reverb.disconnect();
    }
    stretches = stretches.filter((stretch) => !stretch.quiet);
    for (const stretch of stretches) stretch.quiet = stretch.sounding === 0;
    const until = from + 2 * OFFLINE_RENDER_CHUNK_SECONDS;
    const last = until >= length;
    const stretch: StretchGains = { dry: context.createGain(), reverb: context.createGain(), sounding: 0, quiet: false };
    stretch.dry.connect(bus.dry);
    stretch.reverb.connect(bus.reverb);
    stretches.push(stretch);
    const stretchBus: VoiceBus = {
      ...bus,
      dry: stretch.dry,
      reverb: stretch.reverb,
      track(source) {
        bus.track(source);
        stretch.sounding++;
        source.addEventListener('ended', () => stretch.sounding--);
      },
    };
    for (; next < heard.length; next++) {
      const index = heard[next];
      if (!last && contextTime(sounds[index].start) >= until) break;
      if (schedule(stretchBus, index)) voices++;
    }
    if (last) return;
    const stop = from + OFFLINE_RENDER_CHUNK_SECONDS;
    context
      .suspend(stop)
      .then(() => scheduleStretch(stop))
      .catch(giveUp)
      .then(() => context.resume())
      .catch(giveUp);
  };

  scheduleStretch(0);
  return Promise.race([context.startRendering().then((rendered) => (next < heard.length ? null : { rendered, voices })), gaveUp]).finally(() =>
    clearTimeout(stall),
  );
}

async function renderPass(
  sound: FilmSound,
  renderSeconds: number,
  sampleRate: number,
  normalization: number,
  withSpeech: boolean,
  inChunks = true,
): Promise<{ buffer: AudioBuffer; voices: number }> {
  const prerollFrames = Math.round(sampleRate * OFFLINE_PREROLL_SECONDS);
  const frames = Math.ceil(sampleRate * renderSeconds);
  const context = offlineContext(2, prerollFrames + frames, sampleRate);
  const output = context.createBuffer(2, frames, sampleRate);
  const master = createMasterBus(context);
  master.normalization.gain.value = normalization;
  const session = createScoreSession(master, {
    master: sound.score.master,
    speech: withSpeech ? sound.speech : null,
    duration: sound.score.duration,
    origin: prerollFrames / sampleRate,
    rate: 1,
  });
  // The narration's takes are few and start up front; the score's sounds are scheduled by stretch where they can be.
  if (withSpeech && sound.speech !== null) session.speak(playSeconds(0));
  const { sounds } = sound.score;
  const schedule: ScheduleHeard = (bus, index) => {
    const heard = sounds[index];
    return scheduleSound(bus, heard.patch, heard.sound, session.contextTime(heard.at));
  };
  const pass =
    inChunks && sounds.length > 0 && typeof context.suspend === 'function'
      ? await renderInChunks(context, session.bus, sounds, session.contextTime, schedule)
      : await renderWhole(context, session.bus, sounds, schedule);
  if (pass === null) return renderPass(sound, renderSeconds, sampleRate, normalization, withSpeech, false);
  for (let channel = 0; channel < 2; channel++) output.copyToChannel(pass.rendered.getChannelData(channel).subarray(prerollFrames), channel);
  return { buffer: output, voices: pass.voices };
}

/** A score's normalization gain is kept per score object, and by content for the newest few (a reload rebuilds the same score). */
const scoreGains = new WeakMap<PlayedScore, number>();
const contentGains = new Map<string, number>();
const CONTENT_GAINS_KEPT = 4;
const CONTENT_KEY_MAX_CHARS = 4_000_000;

function contentKey(score: PlayedScore, sampleRate: number): string | undefined {
  try {
    const key = JSON.stringify([score.sounds, score.master, score.duration, sampleRate]);
    return key.length <= CONTENT_KEY_MAX_CHARS ? key : undefined;
  } catch {
    return undefined;
  }
}

function rememberGain(score: PlayedScore, key: string | undefined, gain: number | undefined): void {
  if (gain === undefined) return;
  scoreGains.set(score, gain);
  if (key === undefined) return;
  contentGains.delete(key);
  contentGains.set(key, gain);
  for (const oldest of contentGains.keys()) {
    if (contentGains.size <= CONTENT_GAINS_KEPT) break;
    contentGains.delete(oldest);
  }
}

function keptGain(score: PlayedScore, key: string | undefined): number | undefined {
  const gain = key === undefined ? undefined : contentGains.get(key);
  if (gain !== undefined) rememberGain(score, key, gain);
  return gain;
}

/** The normalization gain already known for a score, if any. */
export function knownScoreGain(score: PlayedScore): number | undefined {
  return scoreGains.get(score) ?? (score.sounds.length === 0 ? 1 : undefined);
}

/** Renders the score alone, measures it, and gives the gain that brings it to its loudness target. */
export async function measureScoreGain(score: PlayedScore, sampleRate = DEFAULT_SAMPLE_RATE): Promise<number> {
  const known = scoreGains.get(score);
  if (known !== undefined) return known;
  if (score.sounds.length === 0 || score.master.loudness === null) return 1;
  const key = contentKey(score, sampleRate);
  const kept = keptGain(score, key);
  if (kept !== undefined) return kept;
  const { buffer } = await renderPass({ score, speech: null }, Math.max(0.1, score.duration), sampleRate, 1, false);
  const measurement = measureIntegratedLoudness(buffer);
  const gain = loudnessGain(measurement, score.master.loudness);
  rememberGain(score, key, Number.isFinite(measurement.lufs) ? gain : undefined);
  return gain;
}

/**
 * The whole film's sound, for export: the score normalized to its loudness target (rendered and measured first when its
 * gain is not known yet), with the narration on top.
 */
export async function renderFilmAudio(sound: FilmSound, options: RenderOptions = {}): Promise<FilmAudioRender> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const tail = options.tail ?? 0;
  const renderSeconds = Math.max(0.1, sound.score.duration + tail);
  const startedAt = performance.now();
  const known = knownScoreGain(sound.score);
  const key = known === undefined ? contentKey(sound.score, sampleRate) : undefined;
  const gainBefore = known ?? keptGain(sound.score, key);
  const raw = await renderPass(sound, renderSeconds, sampleRate, gainBefore ?? 1, gainBefore !== undefined);
  const rawMeasurement = measureIntegratedLoudness(raw.buffer);
  if (gainBefore !== undefined) {
    return {
      buffer: raw.buffer,
      voices: raw.voices,
      ms: performance.now() - startedAt,
      lufsRaw: rawMeasurement.lufs - 20 * Math.log10(gainBefore),
      gain: gainBefore,
      ...rawMeasurement,
    };
  }
  const gain = loudnessGain(rawMeasurement, sound.score.master.loudness);
  // A render with a tail measures more than the score, so its gain is not kept for the score.
  rememberGain(sound.score, key, tail === 0 && Number.isFinite(rawMeasurement.lufs) ? gain : undefined);
  const final =
    sound.speech === null && Math.abs(20 * Math.log10(gain)) < UNITY_TOLERANCE_DB
      ? raw
      : await renderPass(sound, renderSeconds, sampleRate, gain, true);
  const measurement = final === raw ? rawMeasurement : measureIntegratedLoudness(final.buffer);
  return {
    buffer: final.buffer,
    voices: final.voices,
    ms: performance.now() - startedAt,
    lufsRaw: rawMeasurement.lufs,
    gain,
    ...measurement,
  };
}

/** Lays takes end to end, up to the first minute, as narration's loudness is measured on them. */
export function speechForMeasure(takes: Iterable<AudioBuffer>): { clips: SpeechClip[]; duration: PlaySeconds } {
  const clips: SpeechClip[] = [];
  let duration = 0;
  for (const buffer of takes) {
    if (duration >= SPEECH_MEASURE_SECONDS) break;
    clips.push({ at: playSeconds(duration), buffer });
    duration += buffer.duration;
  }
  return { clips, duration: playSeconds(duration) };
}

/** The gain that brings narration's takes, played through the mix, to `targetLufs`. */
export async function measureSpeechGain(takes: Iterable<AudioBuffer>, targetLufs: number, sampleRate = DEFAULT_SAMPLE_RATE): Promise<number> {
  const { clips, duration } = speechForMeasure(takes);
  if (clips.length === 0) return 1;
  const master = { gain: 0, fadeOut: 0 };
  const render = await renderFilmAudio(
    { score: { sounds: [], master, duration }, speech: { clips, gain: 1, duck: [] } },
    { sampleRate },
  );
  return loudnessGain(render, targetLufs);
}
