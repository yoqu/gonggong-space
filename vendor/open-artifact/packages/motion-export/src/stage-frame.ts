import { SNAPSHOT_SETTINGS } from '@open-artifact/motion-core';
import { ExportCheckError, FrameRenderError, FrameStallError, RasterDecodeError, SnapshotLimitError } from './errors.ts';
import type { FrameSource } from './frame-source.ts';
import { MAX_RASTER_SIDE } from './raster/host.ts';
import type { RasterHost } from './raster/host.ts';
import type { ExportFrame } from './types.ts';
import { words } from './words.ts';

const fitsRaster = (side: number): boolean => side >= 1 && side <= MAX_RASTER_SIDE;

/**
 * Frames from the stage, as pictures: the stage's snapshot drawn by the raster frame. A frame the film could not draw
 * is a FrameRenderError; one the browser held up is a FrameStallError.
 */
export function stageExportFrame(source: FrameSource, raster: RasterHost): ExportFrame {
  return async (t, width, height) => {
    const facts = source.facts();
    if (facts === null) throw new FrameStallError(words.filmNotLoaded);
    const answer = await source.frame(t, { scale: width / facts.width, smallMedia: false, readFx: SNAPSHOT_SETTINGS.fx === 'read', smooth: false });
    switch (answer.kind) {
      case 'unloaded':
        throw new FrameStallError(words.filmNotLoaded);
      case 'failed':
        throw answer.env ? new FrameStallError(answer.message) : new FrameRenderError(answer.message, t, answer.hold);
      case 'picture': {
        if (!fitsRaster(answer.pw) || !fitsRaster(answer.ph) || Math.abs(answer.pw - width) > 1 || Math.abs(answer.ph - height) > 1)
          throw new ExportCheckError(words.frameTorn, 'torn_frame');
        try {
          return await raster.raster(answer.svg, answer.pw, answer.ph);
        } catch (error) {
          if (error instanceof RasterDecodeError || error instanceof SnapshotLimitError) throw new FrameRenderError(error.message, t, true);
          throw error;
        }
      }
      default: {
        const never: never = answer;
        return never;
      }
    }
  };
}
