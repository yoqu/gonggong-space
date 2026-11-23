import { create } from 'zustand';
import { useBoard } from '../state/board.ts';

export const useBoardRecovery = create(() => ({ paused: false }));
const SETTLE_MS = 5000;
let finishGuard: (() => void) | undefined;
const marker = () => 'wb-load:' + location.pathname;

/** Hold a per-board marker until the document is loaded and the renderer has delivered five seconds of frames. */
function guard(storage: Storage, key: string, retry: boolean, release: () => void): void {
  let frame = 0;
  const clear = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('pagehide', clear);
    finishGuard = undefined;
    try {
      storage.removeItem(key);
    } finally {
      release();
    }
  };
  const paused = storage.getItem(key) !== null || sessionStorage.getItem(key + ':paused') !== null;
  if (paused && !retry) {
    sessionStorage.setItem(key + ':paused', '1');
    useBoardRecovery.setState({ paused: true });
  }
  storage.setItem(key, '1');
  finishGuard = clear;
  window.addEventListener('pagehide', clear, { once: true });
  let since = 0;
  let last = 0;
  const tick = (now: number) => {
    const status = useBoard.getState().status;
    if (document.hidden || now - last > 2000 || (status !== 'ready' && status !== 'cached')) since = now;
    last = now;
    if (now - since >= SETTLE_MS) clear();
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

/** Web Locks distinguish an interrupted load from another tab currently opening this board. */
export async function prepareBoardLoad(retry = false): Promise<void> {
  const key = marker();
  try {
    if (!navigator.locks) return guard(sessionStorage, key, retry, () => {});
    await new Promise<void>((ready, reject) => {
      void navigator.locks.request(key, { ifAvailable: true }, (lock) => new Promise<void>((release) => {
        try {
          guard(lock ? localStorage : sessionStorage, key, retry, release);
          ready();
        } catch (error) {
          release();
          reject(error);
        }
      })).catch(reject);
    });
  } catch { /* A storage-restricted embed can still open the board normally. */ }
}

/** Resume in place to preserve edits and the camera, guarding the first real media load as well. */
export async function showBoardMedia(): Promise<void> {
  finishGuard?.();
  try { sessionStorage.removeItem(marker() + ':paused'); } catch { /* Storage can be disabled. */ }
  await prepareBoardLoad(true);
  useBoardRecovery.setState({ paused: false });
}
