/** What an export says to people. */

export const COMPATIBILITY_ADVICE = 'Try exporting from Chrome on a Mac or Windows computer for best results.';
export const ENCODER_RECOVERY_ADVICE = 'Try again with GIF, or try another browser.';

export const words = {
  exportCancelled: 'Export cancelled',
  videoUnsupported: 'This browser can’t export video. Try Chrome on a computer.',
  encoderSilent: 'The video encoder didn’t respond. ' + ENCODER_RECOVERY_ADVICE,
  skippedFrames: (skipped: number, frames: number): string =>
    `The video encoder skipped ${skipped} of ${frames} frames, so no video was saved. ${ENCODER_RECOVERY_ADVICE}`,
  noCanvas: 'Could not create a 2D canvas for encoding.',
  noOutput: 'The encoder produced no output.',
  noFilm: 'No video is loaded.',
  filmNotLoaded: 'the film is not loaded',
  noFrame: (first: string): string => 'No frame could be rendered. First error: ' + first,
  slowFailures: (count: number, t: number, first: string): string =>
    `Frames keep failing slowly (${count} so far); stopped at ${t.toFixed(3)} s. First error: ${first}`,
  frameTorn: 'The frame came back at the wrong size.',
  rasterTimedOut: 'raster timed out',
  rasterGone: 'raster disposed',
  rasterFailed: 'raster failed',
  snapshotTooLarge: 'snapshot too large',
  snapshotOutOfRange: 'snapshot size out of range',
  gifTooLarge: (mb: number): string => `The GIF passed the ${mb} MB limit, so the export stopped.`,
  movTooLarge: (mb: number): string => `The MOV passed the ${mb} MB limit, so the export stopped.`,
  sourceTooLarge: (mb: number): string => `The video’s pictures and clips are too big to download with its code: ${mb} MB at most.`,
  standaloneTooLarge: (mb: number): string => `The page would be bigger than ${mb} MB, so it was not made.`,
  assetUnreadable: (name: string): string => `${name} couldn’t be read, so the video’s code couldn’t be put together.`,
} as const;

export const formatLabels = {
  avcAac: 'MP4 · H.264 + AAC',
  avcOpus: 'MP4 · H.264 + Opus audio',
  avcSilent: 'MP4 · H.264, no audio',
  other: (codec: 'vp9' | 'av1', audio: boolean): string => `MP4 · ${codec === 'vp9' ? 'VP9' : 'AV1'}${audio ? ' + Opus audio' : ', no audio'}`,
  avcOpusNote: 'This browser can’t encode audio in the most compatible format. ' + COMPATIBILITY_ADVICE,
  avcSilentNote: 'This browser can’t encode audio, so the video will be silent. ' + COMPATIBILITY_ADVICE,
  otherNote: (audio: boolean): string =>
    'This browser can’t encode video in the most compatible format, so some apps may not play the file' + (audio ? '. ' : ', and it will be silent. ') + COMPATIBILITY_ADVICE,
  gif: 'GIF',
  mov: 'MOV',
} as const;
