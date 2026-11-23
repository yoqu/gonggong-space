import type { FilmShapeId } from '@open-artifact/motion-core';
import type { ExportPhase } from '@open-artifact/motion-export';

export const EXPORT = 'Export';
export const EXPORT_UNAVAILABLE = 'Export is available once the animation has loaded';
export const CANCEL = 'Cancel';
export const CLOSE = 'Close';
export const DONE = 'Done';
export const TRY_AGAIN = 'Try again';
export const RELOAD = 'Reload';
export const RELOAD_TO_EXPORT = 'The editor was updated after this page opened. Reload the page, then export again.';
export const EXPORT_ANYWAY = 'Export anyway';
export const USE_SMALLER = 'Use smaller settings';

export const FORMAT = 'Format';
export const FORMAT_LABELS = { video: 'MP4', gif: 'GIF', mov: 'MOV', zip: 'Code', html: 'Page' } as const;
export const FORMAT_TIPS = {
  video: 'An MP4 video with its sound',
  gif: 'A GIF: no sound, plays in a loop',
  mov: 'A MOV that keeps the transparent background, for a video editor',
  zip: 'A ZIP of the animation’s code, its pictures and fonts, with a page that plays it',
  html: 'One HTML file that plays the animation offline',
} as const;
export const GIF_DESCRIPTION = 'A GIF has no sound and plays in a loop.';
export const MOV_FORMAT_DESCRIPTION = 'Keeps the transparent background, to lay over footage in a video editor. QuickTime Player might not open the file.';
export const OPAQUE_EXPORT_DESCRIPTION = 'The transparent background comes out black. MOV keeps it.';
export const ZIP_DESCRIPTION =
  'The animation’s code, pictures, clips and fonts with their licences, a README, and index.html, a page that plays it offline.';
export const HTML_DESCRIPTION = 'One HTML file that plays the animation in any browser, offline, with its sound.';

export const RESOLUTION = 'Resolution';
export const FRAME_RATE = 'Frame rate';
export const fpsLabel = (rate: number): string => `${rate} fps`;
export const FRAME_RATE_TIPS = { full: 'The animation’s own rate', half: 'About half the export time', quarter: 'About a quarter of the export time' } as const;
export const QUALITY = 'Quality';
export const QUALITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export const QUALITY_TIPS = { high: 'The sharpest picture', medium: 'A smaller file', low: 'The smallest file' } as const;
export const SUPERSAMPLE = 'Sharper text (renders at 2×, slower)';
export const SIZE = 'Size';
export const GIF_SIZES = { standard: 'Standard', small: 'Small' } as const;

export const SHAPE = 'Shape';
export const RATIO = 'Ratio';
export const OWN_SHAPE = 'This animation’s shape';
export const SHAPE_NAMES: Readonly<Record<FilmShapeId | 'custom', string>> = {
  wide: 'Wide',
  vertical: 'Vertical',
  square: 'Square',
  portrait: 'Portrait',
  custom: 'Other ratio',
};
export const shapeLabel = (name: string, ratio: string): string => `${name} · ${ratio}`;
export const makeShapeLabel = (id: FilmShapeId | null, ratio: string): string =>
  id === null ? `Make ${ratio} animation` : `Make ${SHAPE_NAMES[id].toLowerCase()} animation`;
export const ANOTHER_SHAPE = 'Make it in another shape';
export const shapeSecondAnimation = (agent: string): string =>
  `${agent} will make a second animation in this shape, which takes a few minutes. This one won’t change.`;
export const RATIO_ACROSS = 'Width part of the ratio';
export const RATIO_DOWN = 'Height part of the ratio';
export const RATIO_HELP = 'Type a ratio from 1:3 to 3:1, each side a whole number up to 999.';
export const OTHER_RATIO = 'Other ratio…';
export const SAME_SHAPE ='That is this animation’s own shape.';

export const ESTIMATING = 'Estimating…';
export const upTo = (size: string): string => `Up to ${size}`;
export const about = (size: string): string => `about ${size}`;
export const atLeast = (size: string): string => `at least ${size}, maybe far more`;
export const halfRateTip = (rate: number): string => `${rate} fps takes about half as long.`;
export const UNDER_A_MINUTE = 'under a minute';
export const aboutMinutes = (minutes: number): string => (minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`);
export const ESTIMATE_FAILED = 'Couldn’t render the sample frames, so the export may fail too.';
export const ESTIMATE_FILM_FAILED = 'The animation’s code is failing on the frames sampled; an export will repeat or stop at those frames.';
export const ESTIMATE_SLOW = 'The sample frames took too long, so there’s no estimate. Keep this page open and in front until the export is done.';
export const NO_VIDEO_HERE = 'This browser can’t export video. Try Chrome on a computer, or export a GIF.';
export const NO_MP4_HERE = 'This browser can’t export MP4 video. Try GIF or MOV.';
export const CHECKING_BROWSER = 'Checking this browser…';

export const LONG_EXPORT_TITLE = 'This export takes a while';
export const longExport = (time: string): string => `It takes ${time}. Keep this page open and in front until it’s done.`;
export const GIF_LARGE = 'This GIF will be large.';
export const gifOverLimit = (mb: number): string => `This GIF would be over the ${mb} MB limit.`;
export const TRY_SMALL = 'Try Small, or export a video instead.';
export const TRY_SMALL_ONLY = 'Try Small.';
export const TRY_VIDEO = 'Try exporting a video instead.';
export const movPerSecond = (size: string, whole: boolean): string => (whole ? `About ${size} per second` : `About ${size} per second of movement`);
export const movSoundFills = (mb: number): string => `This animation’s sound alone leaves no room under MOV’s ${mb} MB limit.`;
export const movStopsAt = (mb: number, seconds: number, whole: boolean): string => {
  const what = whole ? 'animation' : 'movement';
  if (seconds < 1) return `The export stops at the ${mb} MB limit, under a second of ${what}.`;
  return `The export stops at the ${mb} MB limit, about ${seconds} ${seconds === 1 ? 'second' : 'seconds'} of ${what}.`;
};
export const MOV_SHORTER = 'A shorter animation would fit.';
export const MOV_SHORTER_OR_STILLER = 'A shorter animation, or less movement, would fit.';
export const MOV_TRY_720_OR_RATE = 'Try 720p or a lower frame rate.';
export const MOV_TRY_720 = 'Try 720p.';
export const MOV_TRY_RATE = 'Try a lower frame rate.';
export const overHostLimit = (mb: number): string => `Over ${mb} MB: your browser saves it instead of the host.`;

export const scenesMissing = (count: number): string =>
  count === 1 ? '1 scene is missing. Only its name will show.' : `${count} scenes are missing. Only their names will show.`;
export const ROUGH_CUT = 'This is a rough cut.';

export const STARTING = 'Starting…';
export const PHASES: Readonly<Record<ExportPhase | 'files', string>> = {
  probe: 'Measuring…',
  audio: 'Rendering sound…',
  frames: 'Rendering frames…',
  mux: 'Writing the file…',
  files: 'Gathering files…',
};
export const framesProgress = (done: number, total: number, percent: number): string => `${done} / ${total} frames · ${percent}%`;
export const percent = (value: number): string => `${value}%`;
export const KEEP_OPEN = 'Keep this page open and in front until the export is done.';

export const exported = (name: string): string => `Exported ${name}`;
export const savedTo = (path: string): string => `Saved to ${path}`;
export const SAVED_BY_BROWSER = 'Your browser saves it to its downloads.';
export const heldFrames = (count: number, total: number, where: string, kind: 'video' | 'gif', clearAtStart = false): string =>
  `${count} of ${total} frames (${where}) hit an error in the animation’s code, so the ${kind === 'gif' ? 'GIF' : 'video'} repeats the previous frame there${clearAtStart ? ' (transparent at the very start)' : ''}.`;
export const heldAt = (time: string): string => `at ${time}`;
export const heldBetween = (from: string, to: string): string => `between ${from} and ${to}`;
export const askToFix = (agent: string): string => `Ask ${agent} to fix`;
export const askToFixThen = (agent: string): string => `Ask ${agent} to fix it, then export again.`;
export const EXPORT_INCOMPLETE = 'The export didn’t finish.';
export const frameFailedAt = (time: string): string => `A frame at ${time} could not be rendered.`;
export const askForFix = (agent: string): string => `Ask ${agent} for a fix, or try again.`;
export const notSaved = (kind: 'video' | 'gif' | 'mov' | 'zip' | 'html'): string =>
  kind === 'gif' ? 'The GIF wasn’t saved.' : kind === 'video' || kind === 'mov' ? 'The video wasn’t saved.' : 'The file wasn’t saved.';
export const REDUCE_HELP = 'Try a lower quality, frame rate or resolution.';
export const DOWNLOAD_INSTEAD = 'Download instead';
export const fontsLeftOut = (families: readonly string[]): string =>
  `Left out for their licences: ${families.join(', ')}. The README says why.`;
export const NOT_READY = 'The animation isn’t ready yet. Try again in a moment.';
export const filesLeftOut = (files: readonly string[]): string => `Left out, too large to carry: ${files.join(', ')}.`;
export const EXPORT_FAILED = 'The export failed.';
