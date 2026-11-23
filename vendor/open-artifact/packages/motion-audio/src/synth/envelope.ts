const LEAST_ATTACK = 0.0005;
const LEAST_DECAY = 0.001;

/** A struck sound: up to `peak` over `attack`, then an exponential fall with time constant `decay`, silent at `stop`. */
export interface DecayShape {
  readonly peak: number;
  readonly attack: number;
  readonly decay: number;
  readonly stop: number;
}

/** A held sound: attack to `peak`, decay towards `peak × sustain`, held for the note's length, then released. */
export interface AdsrShape {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  readonly peak: number;
}

/** When a held note lets go: after its length, but never before its attack is over. */
export function adsrReleaseAt(at: number, duration: number, attack: number): number {
  return at + Math.max(duration, attack + 0.01);
}

/** The level a held note has fallen to `elapsed` seconds after its start (still in its decay phase). */
export function adsrLevelAt(elapsed: number, shape: AdsrShape): number {
  const held = shape.peak * shape.sustain;
  return held + (shape.peak - held) * Math.exp(-(elapsed - shape.attack) / Math.max(LEAST_DECAY, shape.decay));
}

/** When a held note is silent: its release after it lets go. */
export function adsrEnd(at: number, duration: number, shape: AdsrShape): number {
  return adsrReleaseAt(at, duration, shape.attack) + shape.release;
}

export function decayEnvelope(context: BaseAudioContext, destination: AudioNode, at: number, shape: DecayShape): GainNode {
  const envelope = context.createGain();
  const peakAt = at + Math.max(LEAST_ATTACK, shape.attack);
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(shape.peak, peakAt);
  envelope.gain.setTargetAtTime(0, peakAt, Math.max(LEAST_DECAY, shape.decay));
  envelope.gain.setValueAtTime(0, shape.stop);
  envelope.connect(destination);
  return envelope;
}

export function adsrEnvelope(
  context: BaseAudioContext,
  destination: AudioNode,
  at: number,
  duration: number,
  shape: AdsrShape,
): { gain: GainNode; end: number } {
  const envelope = context.createGain();
  const releaseAt = adsrReleaseAt(at, duration, shape.attack);
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(shape.peak, at + shape.attack);
  envelope.gain.setTargetAtTime(shape.peak * shape.sustain, at + shape.attack, Math.max(LEAST_DECAY, shape.decay));
  // setTargetAtTime has no end, so the release starts from the level the decay would have reached by then.
  envelope.gain.setValueAtTime(adsrLevelAt(releaseAt - at, shape), releaseAt);
  envelope.gain.setTargetAtTime(0, releaseAt, Math.max(LEAST_DECAY, shape.release / 4));
  const end = releaseAt + shape.release;
  envelope.gain.setValueAtTime(0, end);
  envelope.connect(destination);
  return { gain: envelope, end };
}
