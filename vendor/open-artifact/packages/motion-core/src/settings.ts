export const EXPORT_SETTINGS = {
  maxMb: 48,
  maxMbRange: [16, 1024],
  roomyMaxMb: 48,
  floorKbps: 0,
  firstPacketS: 12,
  firstPacketSRange: [0, 60],
  onBreak: 'next',
  lastTry: 'software',
  rangeLabel: 'stream',
  withoutH264: 'none',
  againOnReturn: 2,
  againOnReturnRange: [0, 3],
  cantSaveAfter: 0,
  askInView: true,
  askAgain: true,
  clippedTextWaitMs: 512,
  clippedTextWaitMsMax: 2000,
  stallsInView: 2,
  pressWaitS: 10,
  pressWaitSRange: [2, 60],
  pressBusyMs: 400,
  pressBusyMsRange: [0, 2000],
  pressShows: true,
  rasterNextAhead: 20,
  rasterNextAheadRange: [1, 120],
  rasterKeepMax: 2400,
  rasterKeepMaxRange: [120, 12000],
  rasterKeepMaxMb: 640,
  rasterKeepMaxMbRange: [160, 1024],
} as const;

export const SEND_SETTINGS = {
  askOverS: 40,
  chooseMinS: 20,
  chooseMaxS: 60,
  moreMaxS: 0,
  fasterOverS: 90,
  hdMaxS: 0,
} as const;

export const TWEAKS_SETTINGS = { elsewhere: true } as const;

export const VOICE_SETTINGS = {
  duckDb: -12,
  duckDbRange: [-30, 0],
  loudness: -16,
  loudnessRange: [-30, -10],
  maxLines: 100,
  maxLineSeconds: 30,
  maxSpeechSeconds: 36_000,
  maxLineChars: 300,
  maxTakeKib: 256,
  maxWavKib: 1536,
} as const;

export const SCENE_SETTINGS = {
  shortestPct: 50,
  shortestPctRange: [50, 100],
  longestPct: 300,
  longestPctRange: [100, 300],
  flashCheck: true,
  flashWaitMs: 10_000,
  flashWaitMsRange: [1000, 60_000],
  /** 0, or 1000 to 10 000. */
  flashPatienceMs: 3000,
  flashPatienceMsRange: [1000, 10_000],
  flashUncheckedPct: 50,
  flashAhead: 4,
  flashAheadRange: [1, 8],
} as const;

export const SHAPE_SETTINGS = { label: false, afterExport: 'none' } as const;

export const TIMELINE_SETTINGS = { rows: 'cards', descriptions: true, keep: true } as const;

export const SNAPSHOT_SETTINGS = { fx: 'read' } as const;

export const TEXT_SETTINGS = { styles: true } as const;

export const FONT_SETTINGS = {
  fetch: 'all',
  held: 'saved',
  heldNote: true,
  sheetMs: 2000,
  sheetMsRange: [500, 10_000],
  fileMs: 2500,
  lateMs: 15_000,
  lateMsRange: [0, 30_000],
  rows: 'cards',
  seenBp: 10,
  offer: null,
} as const;

export const TIME_LEFT_SETTINGS = {
  making: { sceneS: 14, finishS: 40, firstFromS: 60, firstToS: 180 },
  finalizing: { sceneS: 14, finishS: 25, usualFromMin: 2, usualToMin: 5 },
  lateTimes: 3,
  lateTimesRange: [2, 10],
  lateS: 45,
  lateSRange: [10, 600],
} as const;

export const WORKING_SETTINGS = {
  cursor: false,
  afterIdle: true,
  unsaidAfterS: 90,
  unsaidAfterSRange: [0, 3600],
} as const;

export const GIF_SETTINGS = {
  maxMb: 50,
  heavyMb: 10,
  estimateExtraS: 2,
  standard: { shortSide: 360, delayCs: 8 },
  small: { shortSide: 270, delayCs: 10 },
} as const;

export const CODE_SETTINGS = { folder: false, phones: false, maxMb: 64, fonts: 'licensed' } as const;

export const MISC_SETTINGS = {
  smoothRestart: false,
  phoneEditing: false,
  phoneBar: 'banded',
  agentEditsPresence: false,
} as const;

/** A number kept in its range; a value that is not a finite number gives the fallback. */
export function clampSetting(value: unknown, range: readonly [number, number], fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(range[1], Math.max(range[0], value)) : fallback;
}
