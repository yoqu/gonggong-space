import type { PcmSource } from './loudness.ts';

const HEADER_BYTES = 44;
/** A narration take read as a wave may be at most this sample rate. */
const MOST_TAKE_HZ = 48000;

/** Writes the 44-byte header of a 16-bit PCM wave filling `bytes` (header included). */
export function writeWaveHeader(bytes: ArrayBuffer, sampleRate: number, channels: number): DataView {
  const view = new DataView(bytes);
  const ascii = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index++) view.setUint8(at + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, bytes.byteLength - HEADER_BYTES, true);
  return view;
}

/** A buffer as a 16-bit PCM wave file, its samples clamped to full scale. */
export function encodePcmWave(buffer: PcmSource): Uint8Array<ArrayBuffer> {
  const { numberOfChannels: channels, length } = buffer;
  const bytes = new Uint8Array(HEADER_BYTES + length * channels * 2);
  const view = writeWaveHeader(bytes.buffer, buffer.sampleRate, channels);
  const channelSamples = Array.from({ length: channels }, (_unused, index) => buffer.getChannelData(index));
  let at = HEADER_BYTES;
  for (let frame = 0; frame < length; frame++) {
    for (const samples of channelSamples) {
      const sample = Math.max(-1, Math.min(1, samples[frame] ?? 0));
      view.setInt16(at, sample < 0 ? sample * 32768 : sample * 32767, true);
      at += 2;
    }
  }
  return bytes;
}

/** A buffer's channels interleaved frame by frame, as encoders take PCM. */
export function interleave(buffer: PcmSource): Float32Array<ArrayBuffer> {
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(buffer.length * channels);
  for (let channel = 0; channel < channels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let frame = 0; frame < buffer.length; frame++) out[frame * channels + channel] = samples[frame] ?? 0;
  }
  return out;
}

/** A take that is a plain 16-bit PCM wave: its length, and the same samples behind a bare 44-byte header. */
export interface PcmWave {
  readonly seconds: number;
  bare(): ArrayBuffer;
}

/**
 * Reads a take as a plain 16-bit PCM wave (one or two channels, up to 48 kHz) by its chunks, so its length is known
 * before it is decoded. Anything else is null.
 */
export function parsePcmWave(bytes: ArrayBuffer): PcmWave | null {
  const view = new DataView(bytes);
  const tag = (at: number): string =>
    String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || 8 + view.getUint32(4, true) !== bytes.byteLength) return null;
  let format: { hz: number; channels: number } | null = null;
  let data: { at: number; size: number } | null = null;
  for (let at = 12; at < bytes.byteLength; ) {
    if (at + 8 > bytes.byteLength) return null;
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > bytes.byteLength) return null;
    const chunk = tag(at);
    if (chunk === 'fmt ') {
      if (format !== null || size < 16) return null;
      const code = view.getUint16(at + 8, true);
      const channels = view.getUint16(at + 10, true);
      const hz = view.getUint32(at + 12, true);
      const bytesPerSecond = view.getUint32(at + 16, true);
      const blockAlign = view.getUint16(at + 20, true);
      const bits = view.getUint16(at + 22, true);
      if (
        code !== 1 ||
        bits !== 16 ||
        (channels !== 1 && channels !== 2) ||
        hz === 0 ||
        hz > MOST_TAKE_HZ ||
        blockAlign !== channels * 2 ||
        bytesPerSecond !== hz * blockAlign
      ) {
        return null;
      }
      format = { hz, channels };
    } else if (chunk === 'data') {
      if (format === null || data !== null || size === 0 || size % (format.channels * 2) !== 0) return null;
      data = { at: at + 8, size };
    }
    at += 8 + size + (size % 2);
  }
  if (format === null || data === null) return null;
  const { hz, channels } = format;
  const { at: dataAt, size: dataSize } = data;
  return {
    seconds: dataSize / (hz * channels * 2),
    bare() {
      const out = new Uint8Array(HEADER_BYTES + dataSize);
      writeWaveHeader(out.buffer, hz, channels);
      out.set(new Uint8Array(bytes, dataAt, dataSize), HEADER_BYTES);
      return out.buffer;
    },
  };
}
