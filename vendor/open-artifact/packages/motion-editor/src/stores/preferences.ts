/** What this device keeps of the player between visits: loop and volume. Sound always starts on; muting lasts for the visit. */

export interface PlayerPreferences {
  loop: boolean;
  volume: number;
}

const KEY = 'video-player-preferences';
export const DEFAULT_PREFERENCES: PlayerPreferences = { loop: false, volume: 1 };

export function parsePreferences(text: string | null): PlayerPreferences {
  if (text === null) return DEFAULT_PREFERENCES;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES;
    const loop = 'loop' in value && typeof value.loop === 'boolean' ? value.loop : DEFAULT_PREFERENCES.loop;
    const volume =
      'volume' in value && typeof value.volume === 'number' && Number.isFinite(value.volume) ? Math.min(1, Math.max(0, value.volume)) : DEFAULT_PREFERENCES.volume;
    return { loop, volume };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function readPreferences(): PlayerPreferences {
  try {
    return parsePreferences(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writePreferences(preferences: PlayerPreferences): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Storage off or full: the choice lasts this visit only.
  }
}
