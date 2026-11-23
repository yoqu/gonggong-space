/**
 * GIF sessions run step by step on the module: in the Worker, or in-thread
 * where there is none. A session gathers sample frames for its palette,
 * then encodes frames, moving finished bytes out of the module as it goes.
 */

import type { GifEncoder as WasmGifEncoder, GifPaletteBuilder as WasmGifPaletteBuilder } from '../generated/open_artifact_motion.js';
import { videoModule } from './module.ts';

/** One step of a session. */
export type GifStep =
  | { kind: 'open'; width: number; height: number; repeat: number; palette: Uint8Array | null }
  | { kind: 'sample'; pixels: Uint8Array }
  | { kind: 'add'; pixels: Uint8Array; delayCs: number }
  | { kind: 'finish' }
  | { kind: 'close' };

/** What a step answers: the GIF's size so far after `add`, its bytes after `finish`. */
export type GifAnswer = number | Uint8Array | null;

/** Page → Worker. */
export interface GifStepMessage {
  id: number;
  session: number;
  step: GifStep;
}

/** Worker → page. */
export type GifWorkerMessage =
  | { type: 'ready' }
  | { id: number; type: 'done'; answer: GifAnswer }
  | { id: number; type: 'failed'; message: string; fatal: boolean };

interface Session {
  width: number;
  height: number;
  repeat: number;
  palette: Uint8Array | null;
  samples: WasmGifPaletteBuilder | null;
  encoder: WasmGifEncoder | null;
  chunks: Uint8Array[];
  byteLength: number;
}

const sessions = new Map<number, Session>();

function release(id: number): void {
  const session = sessions.get(id);
  if (!session) return;
  session.samples?.free();
  session.encoder?.free();
  sessions.delete(id);
}

function sessionOf(id: number): Session {
  const session = sessions.get(id);
  if (!session) throw new Error('The GIF session is closed.');
  return session;
}

/** The encoder, made on the first frame with the palette given or picked from the samples (or that frame). */
function encoderOf(session: Session, first: Uint8Array): WasmGifEncoder {
  if (session.encoder) return session.encoder;
  const wasm = videoModule();
  let palette = session.palette;
  if (palette === null) {
    const samples = session.samples ?? new wasm.GifPaletteBuilder(false);
    if (session.samples === null) samples.add(first);
    palette = samples.finish();
    samples.free();
    session.samples = null;
  }
  session.encoder = new wasm.GifEncoder(session.width, session.height, palette, session.repeat);
  return session.encoder;
}

function joined(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** Runs one step of session `id`. A step that throws closes the session. */
export function runGifStep(id: number, step: GifStep): GifAnswer {
  try {
    switch (step.kind) {
      case 'open': {
        release(id);
        sessions.set(id, {
          width: step.width,
          height: step.height,
          repeat: step.repeat,
          palette: step.palette,
          samples: null,
          encoder: null,
          chunks: [],
          byteLength: 0,
        });
        return null;
      }
      case 'sample': {
        const session = sessionOf(id);
        if (session.encoder || session.palette) return null;
        session.samples ??= new (videoModule().GifPaletteBuilder)(false);
        session.samples.add(step.pixels);
        return null;
      }
      case 'add': {
        const session = sessionOf(id);
        const encoder = encoderOf(session, step.pixels);
        encoder.add(step.pixels, step.delayCs);
        const ready = encoder.takeReady();
        if (ready.length > 0) session.chunks.push(ready);
        session.byteLength = encoder.byteLength;
        return session.byteLength;
      }
      case 'finish': {
        const session = sessionOf(id);
        if (!session.encoder) throw new Error('A GIF needs at least one frame.');
        session.chunks.push(session.encoder.finish());
        const bytes = joined(session.chunks);
        release(id);
        return bytes;
      }
      case 'close':
        release(id);
        return null;
      default: {
        const never: never = step;
        throw new Error(`Unknown GIF step ${String(never)}`);
      }
    }
  } catch (error) {
    release(id);
    throw error;
  }
}
