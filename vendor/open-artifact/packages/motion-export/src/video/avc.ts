/** What an avcC record's sequence parameter set says. */
export interface AvcStreamInfo {
  fullRange: boolean;
  profile: number;
  refFrames: number;
  /** max_num_reorder_frames, when the VUI has a bitstream restriction. */
  reorderFrames?: number;
}

const AVC_HIGH_PROFILES: readonly number[] = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];
const BASELINE_PROFILE = 66;

export function avcConfigBytes(description: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
}

class BitReader {
  #bytes: Uint8Array;
  #at = 0;
  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }
  bits(count: number): number {
    let value = 0;
    for (; count > 0; count--, this.#at++) {
      const byte = this.#bytes[this.#at >> 3];
      if (byte === undefined) throw new RangeError('cut short');
      value = value * 2 + ((byte >> (7 - (this.#at & 7))) & 1);
    }
    return value;
  }
  flag(): boolean {
    return this.bits(1) === 1;
  }
  golomb(): number {
    let zeros = 0;
    while (this.bits(1) === 0) zeros++;
    return 2 ** zeros - 1 + this.bits(zeros);
  }
}

// The SPS without its emulation-prevention bytes (00 00 03 → 00 00).
function unescapedSps(sps: Uint8Array): Uint8Array {
  return sps.subarray(1).filter((byte, index, all) => !(byte === 3 && all[index - 1] === 0 && all[index - 2] === 0));
}

function skipHrd(reader: BitReader): void {
  const count = reader.golomb() + 1;
  reader.bits(8);
  for (let index = 0; index < count; index++) {
    reader.golomb();
    reader.golomb();
    reader.bits(1);
  }
  reader.bits(20);
}

/** The rest of the VUI, up to max_num_reorder_frames; undefined without a bitstream restriction. */
function readReorderFrames(reader: BitReader, colourDescription: boolean): number | undefined {
  try {
    if (colourDescription && reader.flag()) reader.bits(24);
    if (reader.flag()) {
      reader.golomb();
      reader.golomb();
    }
    if (reader.flag()) reader.bits(65);
    const nalHrd = reader.flag();
    if (nalHrd) skipHrd(reader);
    const vclHrd = reader.flag();
    if (vclHrd) skipHrd(reader);
    if (nalHrd || vclHrd) reader.bits(1);
    reader.bits(1);
    if (!reader.flag()) return undefined;
    reader.bits(1);
    for (let index = 0; index < 4; index++) reader.golomb();
    return reader.golomb();
  } catch {
    return undefined;
  }
}

/** Reads an avcC record's SPS; undefined when it cannot be read. */
export function readAvcStreamInfo(description: Uint8Array): AvcStreamInfo | undefined {
  const spsLength = ((description[6] ?? 0) << 8) | (description[7] ?? 0);
  const sps = description.subarray(8, 8 + spsLength);
  if (description[0] !== 1 || ((description[5] ?? 0) & 31) === 0 || ((sps[0] ?? 0) & 31) !== 7) return undefined;
  const reader = new BitReader(unescapedSps(sps));
  try {
    const profile = reader.bits(8);
    reader.bits(16);
    reader.golomb();
    if (AVC_HIGH_PROFILES.includes(profile)) {
      if (reader.golomb() === 3) reader.bits(1);
      reader.golomb();
      reader.golomb();
      reader.bits(1);
      if (reader.flag()) return undefined;
    }
    reader.golomb();
    const pocType = reader.golomb();
    if (pocType === 1) return undefined;
    if (pocType === 0) reader.golomb();
    const refFrames = reader.golomb();
    reader.bits(1);
    reader.golomb();
    reader.golomb();
    if (!reader.flag()) reader.bits(1);
    reader.bits(1);
    if (reader.flag()) for (let index = 0; index < 4; index++) reader.golomb();
    if (!reader.flag()) return { fullRange: false, profile, refFrames };
    if (reader.flag() && reader.bits(8) === 255) reader.bits(32);
    if (reader.flag()) reader.bits(1);
    if (!reader.flag()) return { fullRange: false, profile, refFrames, reorderFrames: readReorderFrames(reader, false) };
    reader.bits(3);
    const fullRange = reader.flag();
    return { fullRange, profile, refFrames, reorderFrames: readReorderFrames(reader, true) };
  } catch {
    return undefined;
  }
}

/** Whether an AVC stream sends frames in display order; undefined when it cannot be told. */
export function avcDecodesInOrder(config: VideoDecoderConfig | undefined): boolean | undefined {
  try {
    const info = config?.description !== undefined && config.codec.startsWith('avc1') ? readAvcStreamInfo(avcConfigBytes(config.description)) : undefined;
    if (info === undefined) return undefined;
    return info.reorderFrames === undefined ? info.refFrames === 1 || info.profile === BASELINE_PROFILE : info.reorderFrames === 0;
  } catch {
    return undefined;
  }
}

/** Makes the decoder config's colour range say what the stream says, which some encoders report wrongly. */
export function repairAvcColorSpace(config: VideoDecoderConfig | undefined): void {
  try {
    const description = config?.description;
    if (config === undefined || !config.codec.startsWith('avc1') || config.colorSpace == null || description === undefined) return;
    const fullRange = readAvcStreamInfo(avcConfigBytes(description))?.fullRange;
    if (fullRange === undefined) return;
    const { primaries, transfer, matrix } = config.colorSpace;
    config.colorSpace = { primaries, transfer, matrix, fullRange };
  } catch {
    // A config that cannot be read is left as it is.
  }
}
