/**
 * The timer chime: two soft bell notes synthesized with Web Audio when the
 * shared timer ends. Audio unlocks on the first click or key press (browsers
 * refuse sound before that); the chime is scheduled ahead on the audio
 * clock so a busy page still rings on time.
 */

import { useEffect } from 'react';

/** Notes: [frequency Hz, delay s]. */
const CHIME_NOTES: readonly (readonly [number, number])[] = [
  [659.25, 0],
  [987.77, 0.24],
];
/** Bell partials: [frequency ratio, level]. */
const CHIME_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2.76, 0.22],
  [5.4, 0.06],
];
const CHIME_GAIN = 0.16;
const CHIME_DECAY_S = 1.8;
/** Schedule the chime this long before the end. */
const CHIME_PREPARE_MS = 10_000;
/** A tab that comes back this late cancels a chime that has not played. */
const CHIME_LATE_MS = 3000;

let context: AudioContext | undefined;
let unlocked = false;
let active = 0;

function audioContext(): AudioContext | undefined {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (context === undefined && typeof AudioContext === 'function' && activation?.hasBeenActive !== false) context = new AudioContext();
  return context;
}

/** Plays the chime at `startAt` (audio clock); returns a function that stops it. */
function playChimeAt(audio: AudioContext, startAt: number, onDone: () => void): () => void {
  const master = audio.createGain();
  master.gain.value = CHIME_GAIN;
  master.connect(audio.destination);
  const oscillators = CHIME_NOTES.flatMap(([pitch, delay]) =>
    CHIME_PARTIALS.map(([ratio, level]) => {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.frequency.value = pitch * ratio;
      envelope.gain.setValueAtTime(0, startAt + delay);
      envelope.gain.linearRampToValueAtTime(level, startAt + delay + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + delay + CHIME_DECAY_S / ratio);
      oscillator.connect(envelope).connect(master);
      oscillator.start(startAt + delay);
      oscillator.stop(startAt + delay + CHIME_DECAY_S / ratio);
      return oscillator;
    }),
  );
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const oscillator of oscillators) {
      try {
        oscillator.stop();
      } catch {
        // Already stopped.
      }
    }
    master.disconnect();
    onDone();
  };
  const last = oscillators[CHIME_PARTIALS.length];
  if (last) last.onended = finish;
  return finish;
}

/** Runs `schedule` with a resumed audio context; plays the chime at the time it returns. */
async function withChimeAudio(schedule: (audio: AudioContext) => number | undefined): Promise<(() => void) | undefined> {
  const audio = audioContext();
  if (audio === undefined) return undefined;
  active += 1;
  const release = () => {
    active -= 1;
    if (active === 0) audio.suspend().catch(() => {});
  };
  try {
    await audio.resume();
    const startAt = schedule(audio);
    if (startAt !== undefined) return playChimeAt(audio, startAt, release);
  } catch {
    // No sound available; the glow still shows.
  }
  release();
  return undefined;
}

function unlockChimeAudio(): void {
  if (!unlocked) void withChimeAudio(() => void (unlocked = true));
}

/** Calls `callback` at `deadline`, re-checking when the tab becomes visible; returns a cancel function. */
export function scheduleAtDeadline(deadline: number, callback: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timeout);
    document.removeEventListener('visibilitychange', check);
  };
  function check() {
    clearTimeout(timeout);
    const wait = deadline - Date.now();
    if (wait > 0) timeout = setTimeout(check, Math.min(wait, 60_000));
    else {
      stop();
      callback();
    }
  }
  document.addEventListener('visibilitychange', check);
  check();
  return stop;
}

/** Rings the chime when a running timer ends (while `enabled`). */
export function useTimerChime(endsAt: number | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || endsAt === null || endsAt <= Date.now()) return;
    let live = true;
    let stopChime: (() => void) | undefined;
    const leftMs = () => endsAt - Date.now();
    const arm = async () => {
      const cancel = await withChimeAudio((audio) => (live && leftMs() > 0 ? audio.currentTime + leftMs() / 1000 : undefined));
      if (live) stopChime = cancel;
      else if (leftMs() > 0) cancel?.();
    };
    const cancelTask = scheduleAtDeadline(endsAt - CHIME_PREPARE_MS, () => void arm());
    const onVisibility = () => {
      if (leftMs() < -CHIME_LATE_MS) stopChime?.();
    };
    document.addEventListener('visibilitychange', onVisibility);
    unlockChimeAudio();
    const options = { capture: true, passive: true } as const;
    for (const type of ['pointerup', 'keydown'] as const) window.addEventListener(type, unlockChimeAudio, options);
    return () => {
      live = false;
      cancelTask();
      if (leftMs() > 0) stopChime?.();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const type of ['pointerup', 'keydown'] as const) window.removeEventListener(type, unlockChimeAudio, options);
    };
  }, [endsAt, enabled]);
}
