/**
 * The sticker party: when the shared timer runs out, every animated emoji
 * sticker in view plays its Noto animation once (stickers are still art the
 * rest of the time).
 *
 * The animated art is a looping WebP. To play it once, its bytes are fetched
 * (ahead of time, while the timer runs), its loop count is set to one and
 * its frame durations are summed; each play shows a fresh blob URL of those
 * bytes (so it starts at the first frame) for that long, then the sticker
 * goes back to its still art.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { BoardElement, ElementId, StickerElement } from '@open-artifact/whiteboard-core';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { notoEmojiArt, stickerEmoji } from './noto-emoji.ts';

/** A WebP made to play once. */
export interface OnceArt {
  bytes: Blob;
  /** How long one play lasts, ms. */
  ms: number;
}

/** Fallback length of one play when the file gives none. */
const DEFAULT_PLAY_MS = 2000;
/** Longest a sticker plays (a long animation is cut short). */
const MAX_PLAY_MS = 6000;

/**
 * Sets an animated WebP's loop count to one and sums its frame durations
 * (undefined when the bytes are not an animated WebP). Changes `bytes`.
 */
export function playOnceWebp(bytes: Uint8Array): number | undefined {
  const text = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  if (bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WEBP') return undefined;
  let ms = 0;
  let animated = false;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const kind = text(at);
    const size = (u24(at + 4) | (bytes[at + 7]! << 24)) >>> 0;
    const body = at + 8;
    if (kind === 'ANIM' && size >= 6 && body + 6 <= bytes.length) {
      animated = true;
      // Loop count: 16 bits after the 4-byte background color (0 = forever).
      bytes[body + 4] = 1;
      bytes[body + 5] = 0;
    } else if (kind === 'ANMF' && size >= 16 && body + 15 <= bytes.length) {
      ms += u24(body + 12);
    }
    at = body + size + (size & 1);
  }
  return animated ? ms : undefined;
}

/** The play-once art of each animated WebP, by URL (fetched once). */
const onceArt = new Map<string, Promise<OnceArt | undefined>>();

/** The play-once art of the animated WebP at `url` (undefined when it fails to load). */
export function loadOnceArt(url: string): Promise<OnceArt | undefined> {
  let art = onceArt.get(url);
  if (!art) {
    art = fetch(url, { mode: 'cors', credentials: 'omit' })
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        const ms = playOnceWebp(bytes) ?? DEFAULT_PLAY_MS;
        return { bytes: new Blob([bytes], { type: 'image/webp' }), ms: Math.min(MAX_PLAY_MS, ms > 0 ? ms : DEFAULT_PLAY_MS) };
      })
      .catch(() => {
        onceArt.delete(url);
        return undefined;
      });
    onceArt.set(url, art);
  }
  return art;
}

/** The animated art URL of a sticker, if it has one. */
export function stickerAnimation(element: BoardElement): string | undefined {
  if (element.type !== 'sticker') return undefined;
  const emoji = stickerEmoji(element);
  return emoji === undefined ? undefined : notoEmojiArt(emoji)?.animated;
}

interface StickerPartyState {
  /** Stickers playing now, each with the party it plays for. */
  playing: ReadonlyMap<ElementId, number>;
}

export const useStickerParty = create<StickerPartyState>()(() => ({ playing: new Map() }));

let rounds = 0;

/** True when the viewer asked for less motion. */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The animated emoji stickers in view (or all of them when the view is unknown). */
function stickersInView(): StickerElement[] {
  const { camera, width, height } = useCamera.getState();
  const left = camera.x;
  const top = camera.y;
  const right = camera.x + width / camera.zoom;
  const bottom = camera.y + height / camera.zoom;
  const known = width > 0 && height > 0;
  const inView = (element: StickerElement) => !known || (element.x < right && element.x + element.w > left && element.y < bottom && element.y + element.h > top);
  return useBoard
    .getState()
    .board.content.elements.filter((element): element is StickerElement => element.type === 'sticker' && stickerAnimation(element) !== undefined && inView(element));
}

/** Fetches the animations of the stickers in view, so the party starts on time. */
export function warmStickerParty(): void {
  for (const element of stickersInView()) void loadOnceArt(stickerAnimation(element)!);
}

/** Every animated emoji sticker in view plays once. */
export function startStickerParty(): void {
  if (reducedMotion()) return;
  const stickers = stickersInView();
  if (stickers.length === 0) return;
  const round = ++rounds;
  const playing = new Map(useStickerParty.getState().playing);
  for (const element of stickers) playing.set(element.id, round);
  useStickerParty.setState({ playing });
}

/** A sticker finished playing for `round`. */
export function stickerPlayed(id: ElementId, round: number): void {
  const current = useStickerParty.getState().playing;
  if (current.get(id) !== round) return;
  const playing = new Map(current);
  playing.delete(id);
  useStickerParty.setState({ playing });
}

/** Plays a sticker's animation once while the party lists it; the one-shot art URL to show, if any. */
export function useStickerPlay(element: BoardElement): string | undefined {
  const round = useStickerParty((state) => state.playing.get(element.id));
  const url = stickerAnimation(element);
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (round === undefined) return;
    if (url === undefined) {
      stickerPlayed(element.id, round);
      return;
    }
    let live = true;
    let shown: string | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void loadOnceArt(url).then((art) => {
      if (!live) return;
      if (!art) return stickerPlayed(element.id, round);
      shown = URL.createObjectURL(art.bytes);
      setSrc(shown);
      timeout = setTimeout(() => {
        setSrc(undefined);
        stickerPlayed(element.id, round);
      }, art.ms);
    });
    return () => {
      live = false;
      clearTimeout(timeout);
      setSrc(undefined);
      // Revoked after the still art had a frame to replace it.
      if (shown !== undefined) {
        const revoke = shown;
        setTimeout(() => URL.revokeObjectURL(revoke), 1000);
      }
    };
  }, [round, url, element.id]);
  return src;
}
