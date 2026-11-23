/**
 * The GIF Worker: runs GIF session steps on the WebAssembly module so the
 * page's thread stays free. It says `ready` once the module is instantiated;
 * finished files travel back transferred.
 *
 * A step that traps the module reports itself `fatal`: the page then drops
 * this Worker (and the sessions in it) and starts a fresh one when needed.
 */

import { runGifStep, type GifStepMessage, type GifWorkerMessage } from './gif-jobs.ts';
import { videoModule } from './module.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<GifStepMessage>) => void) | null;
  postMessage(message: GifWorkerMessage, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id, session, step } = event.data;
  try {
    const answer = runGifStep(session, step);
    const transfer = answer instanceof Uint8Array ? [answer.buffer as ArrayBuffer] : [];
    scope.postMessage({ id, type: 'done', answer }, transfer);
  } catch (error) {
    scope.postMessage({
      id,
      type: 'failed',
      message: error instanceof Error ? error.message : String(error),
      fatal: error instanceof WebAssembly.RuntimeError,
    });
  }
};

videoModule();
scope.postMessage({ type: 'ready' });
