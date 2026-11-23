export { identityTimeline, segmentTimeline } from './timeline.ts';
export type { FilmTimeline, TimelineSegment } from './timeline.ts';

export { MAX_EVENT_SECONDS, SILENT_MASTER, playScore } from './played-score.ts';
export type { PlayedScore, PlayedSound } from './played-score.ts';

export {
  DRUM_ALIASES,
  DRUM_PRESETS,
  FX_ALIASES,
  FX_PRESETS,
  PATCH_ALIASES,
  PATCH_PRESETS,
  resolvePatch,
  ringSeconds,
  soundExtent,
} from './synth/presets.ts';
export type { PatchPreset, ResolvedPatch } from './synth/presets.ts';
export { MAX_SOUND_SECONDS, decibelsToGain, midiToFrequency, readVoiceSettings, velocityToGain, voiceGain, voiceOf } from './synth/voice.ts';
export type { Sound, Voice, VoiceSettings } from './synth/voice.ts';
export { adsrEnd, adsrLevelAt, adsrReleaseAt } from './synth/envelope.ts';
export type { AdsrShape, DecayShape } from './synth/envelope.ts';
export { seededRandom } from './synth/noise.ts';
export { scheduleSound } from './synth/schedule.ts';
export type { VoiceBus, VoiceOutput } from './synth/nodes.ts';

export { createMasterBus, fadeLevel, masterGain, softClipCurve } from './mixer.ts';
export type { MasterBus } from './mixer.ts';
export { REVERB_SECONDS, reverbImpulseSamples } from './reverb.ts';
export { createScoreSession } from './session.ts';
export type { ScoreSession, SessionOptions } from './session.ts';

export {
  DEFAULT_TARGET_LUFS,
  MAX_NORMALIZATION_DB,
  MAX_NORMALIZED_PEAK,
  loudnessGain,
  measureIntegratedLoudness,
  sampleLevels,
} from './loudness.ts';
export type { AudioLevel, LoudnessMeasurement, PcmSource } from './loudness.ts';
export { encodePcmWave, interleave, parsePcmWave } from './wave.ts';
export type { PcmWave } from './wave.ts';
export { DEFAULT_MIDI_TITLE, MIDI_TICKS_PER_BEAT, toMidi } from './midi.ts';
export type { MidiOptions } from './midi.ts';

export {
  LOOKAHEAD_SECONDS,
  SCHEDULER_INTERVAL_MS,
  START_DELAY_SECONDS,
  contextTimeOf,
  dueSounds,
  firstHeard,
  heardFrom,
  lookaheadHorizon,
  passOrigin,
  playTimeAt,
} from './window.ts';
export { startScorePass } from './scheduler.ts';
export type { ScorePass, ScorePassOptions, SchedulerTimers } from './scheduler.ts';

export { DEFAULT_NARRATION_LIMITS } from './narration/limits.ts';
export type { NarrationLimits } from './narration/limits.ts';
export { clipCaption, planNarration } from './narration/plan.ts';
export type { NarrationPlan } from './narration/plan.ts';
export { DUCK_ATTACK_SECONDS, DUCK_RELEASE_SECONDS, duckEnvelope, sampleEnvelope } from './narration/duck.ts';
export type { DuckPoint } from './narration/duck.ts';
export { voicePeaks } from './narration/peaks.ts';
export { placeSpeech } from './narration/speech.ts';
export type { DecodedNarration, Speech, SpeechClip, TakeIssue } from './narration/speech.ts';
export { decodeNarration, judgeTakeBytes, judgeTakeSeconds } from './narration/decode.ts';
export type { DecodeOptions, TakeDecoder } from './narration/decode.ts';
export { captionCues, cueAt, voiceoverLines } from './narration/captions.ts';
export type { CaptionCue, VoiceoverLine } from './narration/captions.ts';

export {
  DEFAULT_SAMPLE_RATE,
  filmSound,
  knownScoreGain,
  measureScoreGain,
  measureSpeechGain,
  renderFilmAudio,
} from './offline.ts';
export type { FilmAudioRender, FilmSound, FilmSoundInput, RenderOptions } from './offline.ts';

export { audioClockSource, createVisibleClock, wallClockSource } from './playback-clock.ts';
export type { PlaybackTimeSource, VisibleClock } from './playback-clock.ts';
export { FilmSoundPlayer } from './player.ts';
export type { FilmSoundPlayerOptions, SoundPlayerState } from './player.ts';
