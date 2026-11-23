import type { PlaySeconds, ScoreMaster } from '@open-artifact/motion-core';
import { fadeLevel, masterGain } from './mixer.ts';
import type { MasterBus } from './mixer.ts';
import { sampleEnvelope } from './narration/duck.ts';
import type { Speech } from './narration/speech.ts';
import { noiseBuffer } from './synth/noise.ts';
import type { VoiceBus } from './synth/nodes.ts';
import { contextTimeOf, playTimeAt } from './window.ts';

/** One pass of playback on a master bus: the score's sends and the narration, from one origin at one rate. */
export interface ScoreSession {
  readonly bus: VoiceBus;
  /** The context time play time 0 stands at. */
  readonly origin: number;
  readonly rate: number;
  contextTime(play: number): number;
  /** Starts the narration's takes and the score's duck from play time `from`. */
  speak(from: PlaySeconds): void;
  /** Fades everything out over a few milliseconds and stops every source. */
  stop(): void;
}

export interface SessionOptions {
  readonly master: ScoreMaster;
  readonly speech: Speech | null;
  readonly duration: PlaySeconds;
  readonly origin: number;
  readonly rate: number;
}

const SPEECH_FADE_SECONDS = 0.02;
const SPEECH_TAIL_SECONDS = 0.03;
const STOP_FADE_SECONDS = 0.03;
const DUCK_RECOVERY_SECONDS = 0.5;
const DISCONNECT_DELAY_MS = 120;

export function createScoreSession(masterBus: MasterBus, options: SessionOptions): ScoreSession {
  const { context } = masterBus;
  const { origin, rate, duration, speech } = options;
  const contextTime = (play: number): number => contextTimeOf(play, origin, rate);
  const level = masterGain(options.master.gain);
  const fadeOut = Math.max(0, Math.min(duration, options.master.fadeOut));
  const endTime = contextTime(duration);

  const dry = context.createGain();
  dry.gain.value = level;
  if (duration > 0 && fadeOut > 0) {
    const now = playTimeAt(context.currentTime, origin, rate);
    const fadeStart = duration - fadeOut;
    if (now <= fadeStart) {
      dry.gain.setValueAtTime(level, contextTime(fadeStart));
      dry.gain.linearRampToValueAtTime(0, endTime);
    } else if (now < duration) {
      dry.gain.setValueAtTime(fadeLevel(level, fadeOut, duration, now), context.currentTime);
      dry.gain.linearRampToValueAtTime(0, endTime);
    } else {
      dry.gain.value = 0;
    }
  }
  dry.connect(masterBus.input);

  const reverb = context.createGain();
  reverb.gain.value = level;
  reverb.connect(masterBus.reverbInput);
  if (duration > 0 && fadeOut > 0) {
    reverb.gain.setValueAtTime(level, Math.max(context.currentTime, contextTime(duration - fadeOut)));
    reverb.gain.linearRampToValueAtTime(0, Math.max(context.currentTime, endTime));
  }

  const sources = new Set<AudioScheduledSourceNode>();
  const bus: VoiceBus = {
    context,
    dry,
    reverb,
    noise: noiseBuffer(context),
    track(source) {
      sources.add(source);
      source.onended = () => sources.delete(source);
    },
  };

  const speechGain = speech === null ? null : context.createGain();
  if (speechGain !== null) {
    speechGain.gain.value = 0;
    speechGain.connect(masterBus.speech);
  }
  const duck = masterBus.duck.gain;

  return {
    bus,
    origin,
    rate,
    contextTime,
    speak(from) {
      const now = context.currentTime;
      if (speech === null || speechGain === null) {
        duck.cancelScheduledValues(now);
        duck.setValueAtTime(1, now);
        return;
      }
      const start = Math.max(now, contextTime(from));
      speechGain.gain.setValueAtTime(0, start);
      speechGain.gain.linearRampToValueAtTime(speech.gain, start + SPEECH_FADE_SECONDS);
      if (endTime - SPEECH_TAIL_SECONDS > start + SPEECH_FADE_SECONDS) {
        speechGain.gain.setValueAtTime(speech.gain, endTime - SPEECH_TAIL_SECONDS);
        speechGain.gain.linearRampToValueAtTime(0, endTime);
      }
      for (const clip of speech.clips) {
        // At a rate other than 1 a take plays faster or slower with the picture, its pitch moving with it.
        const offset = Math.max(0, from - clip.at);
        if (offset >= clip.buffer.duration) continue;
        const source = context.createBufferSource();
        source.buffer = clip.buffer;
        source.playbackRate.value = rate;
        source.connect(speechGain);
        bus.track(source);
        source.start(Math.max(now, contextTime(clip.at + offset)), offset);
      }
      const level = sampleEnvelope(speech.duck, from);
      duck.cancelScheduledValues(now);
      duck.setValueAtTime(level, now);
      duck.setValueAtTime(level, start);
      for (const point of speech.duck) if (point.t > from) duck.linearRampToValueAtTime(point.v, contextTime(point.t));
    },
    stop() {
      const now = context.currentTime;
      try {
        if (speechGain !== null && speech !== null) {
          speechGain.gain.cancelScheduledValues(now);
          speechGain.gain.setValueAtTime(speech.gain * Math.max(0, Math.min(1, (endTime - now) / SPEECH_TAIL_SECONDS)), now);
          speechGain.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
          duck.cancelScheduledValues(now);
          duck.setValueAtTime(sampleEnvelope(speech.duck, playTimeAt(now, origin, rate)), now);
          duck.linearRampToValueAtTime(1, now + DUCK_RECOVERY_SECONDS);
        }
        dry.gain.cancelScheduledValues(now);
        dry.gain.setValueAtTime(dry.gain.value, now);
        dry.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
        reverb.gain.cancelScheduledValues(now);
        reverb.gain.setValueAtTime(0, now);
      } catch {
        // A closed context refuses automation; its sources are stopped below all the same.
      }
      for (const source of sources) {
        try {
          source.stop(now + 0.05);
        } catch {
          // A source that never started cannot be stopped.
        }
      }
      setTimeout(() => {
        dry.disconnect();
        reverb.disconnect();
        speechGain?.disconnect();
      }, DISCONNECT_DELAY_MS);
    },
  };
}
