import { readVideoFlags, type VideoFlags } from '@open-artifact/motion-core';

/** Where a developer turns a feature off in this browser: `{"movExport": false}`. */
export const VIDEO_FLAGS_STORAGE_KEY = 'open-artifact.video.flags';

function storedFlags(): string | null {
  try {
    return localStorage.getItem(VIDEO_FLAGS_STORAGE_KEY);
  } catch {
    return null;
  }
}

let flags: VideoFlags | null = null;

/** The features this page runs with, read once. */
export function videoFlags(): VideoFlags {
  flags ??= readVideoFlags(storedFlags());
  return flags;
}
