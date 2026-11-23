/**
 * The export Worker: runs packing jobs (zip, PDF, PNG) on the WebAssembly
 * module so the page's thread stays free. Results travel back transferred.
 *
 * A job that traps the module reports itself `fatal`: the page then drops
 * this Worker and starts a fresh one for the next job.
 */

import { runJob } from './run.ts';
import type { JobMessage, WorkerMessage } from './types.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<JobMessage>) => void) | null;
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id, job } = event.data;
  const progress = (done: number, total: number): void => scope.postMessage({ id, type: 'progress', done, total });
  runJob(job, progress).then(
    (bytes) => scope.postMessage({ id, type: 'done', bytes }, [bytes.buffer as ArrayBuffer]),
    (error: unknown) =>
      scope.postMessage({
        id,
        type: 'failed',
        message: error instanceof Error ? error.message : String(error),
        fatal: error instanceof WebAssembly.RuntimeError,
      }),
  );
};
