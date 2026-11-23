import { Mp4OutputFormat, Output, StreamTarget } from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';

/** An MP4 being written in memory. `file()` hands out its bytes once, or null when nothing was written. */
export interface Mp4Output {
  output: Output;
  file(): Uint8Array<ArrayBuffer> | null;
}

/**
 * Runs `make` while ArrayBuffer.prototype.resize is hidden: the muxer grows its buffers with it where it exists, and
 * Chrome's resizable buffers can fail to transfer to the encoder.
 */
export function withoutResizableArrayBuffers<T>(make: () => T): T {
  const resize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resize');
  if (resize?.configurable !== true || !Object.isExtensible(ArrayBuffer.prototype)) return make();
  Reflect.deleteProperty(ArrayBuffer.prototype, 'resize');
  try {
    return make();
  } finally {
    Object.defineProperty(ArrayBuffer.prototype, 'resize', resize);
  }
}

export function createMp4Output(): Mp4Output {
  const writes: StreamTargetChunk[] = [];
  const target = new StreamTarget(
    new WritableStream<StreamTargetChunk>({
      write: (chunk) => {
        writes.push(chunk);
      },
    }),
  );
  return {
    output: withoutResizableArrayBuffers(() => new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })),
    file: () => {
      if (writes.length === 0) return null;
      const length = writes.reduce((end, chunk) => Math.max(end, chunk.position + chunk.data.byteLength), 0);
      const bytes = new Uint8Array(length);
      for (const chunk of writes) bytes.set(chunk.data, chunk.position);
      writes.length = 0;
      return bytes;
    },
  };
}
