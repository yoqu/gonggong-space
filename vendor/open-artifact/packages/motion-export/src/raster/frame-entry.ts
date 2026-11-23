import { drawSnapshot, makeHoldFirstDraw, whyNoDecode } from '@open-artifact/motion-stage/raster';
import { isRasterRequest } from './messages.ts';
import type { RasterReply } from './messages.ts';

// Runs in the raster frame: an opaque origin, so a snapshot's pictures cannot taint what the page reads back.
const holdFirstDraw = makeHoldFirstDraw();
let retained = document.createElement('canvas');

const reply = (message: RasterReply, transfer: Transferable[] = []): void => parent.postMessage(message, '*', transfer);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function bitmapOf(surface: HTMLCanvasElement | ImageBitmap): Promise<ImageBitmap> {
  return surface instanceof ImageBitmap ? surface : createImageBitmap(surface);
}

addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (event.source !== parent || !isRasterRequest(request)) return;
  const fail = (error: unknown): void => reply({ rid: request.rid, error: messageOf(error) });
  try {
    const picture = new Image();
    picture.onload = () => {
      holdFirstDraw(request.svg, request.waitMs, () => {
        drawSnapshot(picture, request.pw, request.ph, retained)
          .then(bitmapOf)
          .then((bitmap) => reply({ rid: request.rid, bitmap }, [bitmap]))
          .catch((error: unknown) => {
            retained = document.createElement('canvas');
            fail(error);
          });
      });
    };
    picture.onerror = () => fail('snapshot decode failed (foreignObject)' + whyNoDecode(request.svg));
    picture.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(request.svg);
  } catch (error) {
    fail(error);
  }
});

reply({ rasterReady: true });
