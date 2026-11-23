/**
 * Embeds from outside their view: which embeds are stopped, and what the
 * keyboard can do with one.
 *
 * - Enter on a selected embed that runs *uses* it: its frame gets the
 *   keyboard until Escape inside it comes back to the board
 *   ({@link enterEmbed}).
 * - Enter on an embed stopped for taking the keyboard runs it again
 *   ({@link runEmbedAgain}); so does its view's "Run it again" button.
 * - F2 still edits the HTML.
 *
 * A stop is kept here, by element and HTML, so it outlasts the view (an
 * embed scrolled away and back stays stopped) and ends when the HTML is
 * edited. Each mounted frame registers how to hand it the keyboard
 * ({@link registerEmbedFrame}).
 *
 * No React and no DOM beyond moving focus, so it is unit-tested.
 */

import { create } from 'zustand';
import { type ElementId, type HtmlElement } from '@open-artifact/whiteboard-core';
import { announce } from '../services/announce.ts';
import { useSelection } from '../state/selection.ts';
import { canRunEmbedAgain, embedRefusal, EMBED_RUNS_AGAIN_MESSAGE, type EmbedStopReason } from './embed.ts';

/** A stopped embed: why, and the HTML it was stopped running. */
export interface EmbedStop {
  html: string;
  reason: EmbedStopReason;
}

interface EmbedStopsState {
  /** Stopped embeds by element. */
  stops: ReadonlyMap<ElementId, EmbedStop>;
}

/** The stopped embeds. */
export const useEmbedStops = create<EmbedStopsState>()(() => ({ stops: new Map() }));

/** Why the embed `id` running `html` is stopped, if it is (a stop of other HTML no longer counts). */
export function embedStopFor(stops: ReadonlyMap<ElementId, EmbedStop>, id: ElementId, html: string): EmbedStopReason | undefined {
  const stop = stops.get(id);
  return stop !== undefined && stop.html === html ? stop.reason : undefined;
}

/** Stops the embed `id` running `html`. */
export function stopEmbed(id: ElementId, html: string, reason: EmbedStopReason): void {
  const stops = new Map(useEmbedStops.getState().stops);
  stops.set(id, { html, reason });
  useEmbedStops.setState({ stops });
}

/** Forgets the stop of embed `id`, so it runs again. */
export function clearEmbedStop(id: ElementId): void {
  const current = useEmbedStops.getState().stops;
  if (!current.has(id)) return;
  const stops = new Map(current);
  stops.delete(id);
  useEmbedStops.setState({ stops });
}

/**
 * What an embed is to the keyboard: `'runs'` (Enter uses it), `'off'`
 * (stopped for taking the keyboard; Enter runs it again), or `undefined`
 * (empty, refused or stopped for good: Enter edits it like any item).
 */
export function embedKeyState(element: HtmlElement, stops: ReadonlyMap<ElementId, EmbedStop> = useEmbedStops.getState().stops): 'runs' | 'off' | undefined {
  if (element.html.trim() === '' || embedRefusal(element.html) !== undefined) return undefined;
  const reason = embedStopFor(stops, element.id, element.html);
  if (reason === undefined) return 'runs';
  return canRunEmbedAgain(reason) ? 'off' : undefined;
}

/** What Enter does to a selected embed: use it, run it again, or nothing special. */
export function embedEnterAction(element: HtmlElement): 'use' | 'run-again' | undefined {
  const state = embedKeyState(element);
  return state === 'runs' ? 'use' : state === 'off' ? 'run-again' : undefined;
}

/* ------------------------------------------------------------------------ */
/* Frames                                                                   */
/* ------------------------------------------------------------------------ */

/** What a mounted embed frame offers the keyboard. */
export interface EmbedFrameControl {
  /** Hands the frame the keyboard (it is selected alone first). */
  use(): void;
}

const frames = new Map<ElementId, EmbedFrameControl>();

/** Registers the mounted frame of embed `id`; returns a function that unregisters it. */
export function registerEmbedFrame(id: ElementId, control: EmbedFrameControl): () => void {
  frames.set(id, control);
  return () => {
    if (frames.get(id) === control) frames.delete(id);
  };
}

/** Uses embed `id` (Enter on it): selects it alone and hands its frame the keyboard. `false` when it has no frame. */
export function enterEmbed(id: ElementId): boolean {
  const frame = frames.get(id);
  if (frame === undefined) return false;
  useSelection.getState().select([id]);
  frame.use();
  return true;
}

/** The board's own focus home (its surface). */
export function focusBoardHome(): void {
  if (typeof document === 'undefined') return;
  document.querySelector<HTMLElement>('.wb-surface')?.focus({ preventScroll: true });
}

/** Runs a stopped embed again: selects it alone, keeps the keyboard on the board, and says so. */
export function runEmbedAgain(id: ElementId): void {
  useSelection.getState().select([id]);
  clearEmbedStop(id);
  focusBoardHome();
  announce(EMBED_RUNS_AGAIN_MESSAGE);
}
