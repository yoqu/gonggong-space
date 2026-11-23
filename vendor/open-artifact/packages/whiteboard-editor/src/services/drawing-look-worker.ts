/**
 * The look worker: paints textured drawing looks off the page's thread.
 * Each job is a vetted drawing, a look, a scheme and a pixel size; the
 * answer is a PNG blob (or `null` when the drawing cannot be painted).
 */

import { paintLookJob, type LookJob, type LookJobResult } from './drawing-look-paint.ts';

addEventListener('message', (event: MessageEvent<LookJob>) => {
  void paintLookJob(event.data).then((blob) => {
    const result: LookJobResult = { id: event.data.id, blob };
    postMessage(result);
  });
});
