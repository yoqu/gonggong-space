import { synthesizeDrum } from './drums.ts';
import { synthesizeFx } from './fx.ts';
import { connectVoiceOutput } from './nodes.ts';
import type { VoiceBus } from './nodes.ts';
import { synthesizePatch } from './patches.ts';
import type { ResolvedPatch } from './presets.ts';
import type { Sound } from './voice.ts';

/** Builds a sound's nodes on the bus, starting at context time `at`. False when `at` is not a time. */
export function scheduleSound(bus: VoiceBus, patch: ResolvedPatch, sound: Sound, at: number): boolean {
  if (!Number.isFinite(at)) return false;
  const output = connectVoiceOutput(bus, sound, patch.preset, Math.max(0, at));
  switch (patch.kind) {
    case 'note':
      synthesizePatch(bus, patch.name, sound, output);
      return true;
    case 'drum':
      synthesizeDrum(bus, patch.name, output);
      return true;
    case 'fx':
      synthesizeFx(bus, patch.name, sound, output);
      return true;
    default: {
      const never: never = patch;
      return never;
    }
  }
}
