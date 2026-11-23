/**
 * Upload placeholders in the camera layer (board units), in front of the
 * elements: this page's uploads as the picture itself, faded, with a
 * spinner; other pages' as a box with a spinner (see `uploads.ts`). The
 * spinner keeps its screen size at any zoom.
 */

import { useMemo } from 'react';
import { useCamera } from '../state/camera.ts';
import { visibleUploads } from './upload-wire.ts';
import { useUploads } from './uploads.ts';

/** The spinner, at its screen size. */
function Spinner() {
  const zoom = useCamera((state) => state.camera.zoom);
  return <i className="wb-upload-spin" style={{ scale: String(1 / zoom) }} />;
}

/** Every upload placeholder. */
export function UploadPlaceholders() {
  const own = useUploads((state) => state.own);
  const heard = useUploads((state) => state.heard);
  const others = useMemo(() => visibleUploads(heard), [heard]);
  if (own.length === 0 && others.length === 0) return null;
  return (
    <>
      {own.map((upload) => (
        <div key={upload.id} className="wb-el wb-upload" style={{ left: upload.x, top: upload.y, width: upload.w, height: upload.h }} aria-hidden="true">
          {upload.preview !== undefined ? <img src={upload.preview} alt="" draggable={false} /> : null}
          <Spinner />
        </div>
      ))}
      {others.map((upload) => (
        <div
          key={`${upload.peer} ${upload.id}`}
          className="wb-el wb-upload"
          data-wb-coming=""
          style={{ left: upload.x, top: upload.y, width: upload.w, height: upload.h }}
          aria-hidden="true"
        >
          <Spinner />
        </div>
      ))}
    </>
  );
}
