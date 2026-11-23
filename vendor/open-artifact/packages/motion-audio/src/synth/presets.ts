import { DRUM_NAMES, FX_NAMES, PATCH_NAMES } from '@open-artifact/motion-core';
import type { DrumName, FxName, PatchName, ScoreEventKind } from '@open-artifact/motion-core';

/** A sound's place in the mix: its level in dB, its pan (−1…1) and how much of it goes to the reverb (0…1). */
export interface PatchPreset {
  readonly gain: number;
  readonly pan: number;
  readonly rev: number;
}

export const PATCH_PRESETS: Readonly<Record<PatchName, PatchPreset>> = {
  marimba: { pan: -0.1, rev: 0.35, gain: 0 },
  ep: { pan: 0.25, rev: 0.45, gain: -2 },
  bass: { pan: 0, rev: 0.05, gain: -3 },
  pad: { pan: 0, rev: 0.6, gain: -6 },
  vibes: { pan: -0.3, rev: 0.55, gain: -2 },
  glock: { pan: 0.4, rev: 0.55, gain: -6 },
  pluck: { pan: -0.15, rev: 0.35, gain: -1 },
  keys: { pan: 0.1, rev: 0.3, gain: -5 },
};

export const PATCH_ALIASES: Readonly<Record<string, PatchName>> = {
  rhodes: 'ep',
  piano: 'ep',
  kalimba: 'pluck',
  harp: 'pluck',
  sub: 'bass',
  lead: 'keys',
  synth: 'keys',
  bell: 'glock',
  bells: 'glock',
  celesta: 'glock',
  vibraphone: 'vibes',
  mallet: 'marimba',
  xylophone: 'marimba',
  strings: 'pad',
};

export const DRUM_PRESETS: Readonly<Record<DrumName, PatchPreset>> = {
  kick: { pan: 0, rev: 0.05, gain: 0 },
  snare: { pan: 0.05, rev: 0.25, gain: -2 },
  clap: { pan: -0.1, rev: 0.3, gain: -3 },
  hat: { pan: 0.3, rev: 0.1, gain: -8 },
  openhat: { pan: 0.3, rev: 0.15, gain: -8 },
  shaker: { pan: -0.35, rev: 0.1, gain: -10 },
  sidestick: { pan: 0.1, rev: 0.25, gain: -4 },
  woodblock: { pan: -0.2, rev: 0.2, gain: -4 },
  tamb: { pan: 0.4, rev: 0.2, gain: -8 },
  tom: { pan: -0.25, rev: 0.25, gain: -2 },
  crash: { pan: 0.2, rev: 0.4, gain: -8 },
  ride: { pan: 0.35, rev: 0.3, gain: -9 },
  cowbell: { pan: -0.3, rev: 0.2, gain: -8 },
};

export const DRUM_ALIASES: Readonly<Record<string, DrumName>> = {
  bd: 'kick',
  sd: 'snare',
  hh: 'hat',
  hihat: 'hat',
  ohh: 'openhat',
  stick: 'sidestick',
  rim: 'sidestick',
  wb: 'woodblock',
  block: 'woodblock',
  tambourine: 'tamb',
  cymbal: 'crash',
  shake: 'shaker',
};

export const FX_PRESETS: Readonly<Record<FxName, PatchPreset>> = {
  tick: { pan: 0, rev: 0.12, gain: 2 },
  click: { pan: 0, rev: 0.18, gain: 0 },
  doubleclick: { pan: 0, rev: 0.18, gain: 0 },
  pop: { pan: 0, rev: 0.25, gain: -4 },
  ding: { pan: 0.15, rev: 0.5, gain: -5 },
  chime: { pan: 0.15, rev: 0.55, gain: -6 },
  whoosh: { pan: 0, rev: 0.3, gain: -8 },
  boing: { pan: 0, rev: 0.3, gain: -4 },
  revswell: { pan: 0, rev: 0.45, gain: -8 },
  roll: { pan: 0, rev: 0.2, gain: -6 },
  thud: { pan: 0, rev: 0.2, gain: -2 },
  sparkle: { pan: 0.2, rev: 0.6, gain: -8 },
};

export const FX_ALIASES: Readonly<Record<string, FxName>> = {
  keytick: 'tick',
  key: 'tick',
  tap: 'click',
  swoosh: 'whoosh',
  swish: 'whoosh',
  swell: 'revswell',
  rise: 'revswell',
  bell: 'ding',
  save: 'ding',
  success: 'chime',
  bloop: 'pop',
  bubble: 'pop',
  drop: 'thud',
  land: 'thud',
  twinkle: 'sparkle',
};

export type ResolvedPatch =
  | { readonly kind: 'note'; readonly name: PatchName; readonly preset: PatchPreset }
  | { readonly kind: 'drum'; readonly name: DrumName; readonly preset: PatchPreset }
  | { readonly kind: 'fx'; readonly name: FxName; readonly preset: PatchPreset };

function lookUp<Name extends string>(names: readonly Name[], aliases: Readonly<Record<string, Name>>, wanted: string): Name | undefined {
  const own = names.find((name) => name === wanted);
  if (own !== undefined) return own;
  return Object.hasOwn(aliases, wanted) ? aliases[wanted] : undefined;
}

/** A pitched patch nobody knows plays as a marimba; an unknown drum or effect is silent (null). */
export function resolvePatch(kind: ScoreEventKind, patch: string): ResolvedPatch | null {
  const wanted = String(patch).toLowerCase();
  switch (kind) {
    case 'note': {
      const name = lookUp(PATCH_NAMES, PATCH_ALIASES, wanted) ?? 'marimba';
      return { kind, name, preset: PATCH_PRESETS[name] };
    }
    case 'drum': {
      const name = lookUp(DRUM_NAMES, DRUM_ALIASES, wanted);
      return name === undefined ? null : { kind, name, preset: DRUM_PRESETS[name] };
    }
    case 'fx': {
      const name = lookUp(FX_NAMES, FX_ALIASES, wanted);
      return name === undefined ? null : { kind, name, preset: FX_PRESETS[name] };
    }
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** How long a sound rings after its written length, so a seek into its tail still hears it. */
export function ringSeconds(patch: ResolvedPatch): number {
  switch (patch.kind) {
    case 'note':
      return patch.name === 'pad' ? 1.2 : patch.name === 'vibes' || patch.name === 'glock' ? 1.6 : 0.6;
    case 'fx':
      return 1.2;
    case 'drum':
      return patch.name === 'crash' ? 1.8 : 0.5;
    default: {
      const never: never = patch;
      return never;
    }
  }
}

/** The span a sound is heard over, given its onset and length: a reverse swell is heard before its onset. */
export function soundExtent(patch: ResolvedPatch, at: number, dur: number): [number, number] {
  if (patch.kind === 'fx' && patch.name === 'revswell') return [at - dur, at + 0.4];
  return [at, at + dur + ringSeconds(patch)];
}
