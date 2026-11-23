import { isAskedLook, isLayersReport, isRetouchedRecord } from './layer-guards.ts';
import { STAGE_CONNECT } from './types.ts';
import type {
  Chapter,
  FilmPart,
  HostToStage,
  NarrationLimits,
  NarrationReport,
  PlayedScore,
  SceneReport,
  StageAsset,
  StageConnect,
  StageFace,
  StageFaces,
  StageFilm,
  StageMeta,
  StageModule,
  StageText,
  StageToHost,
} from './types.ts';

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isOptional = <T>(value: unknown, is: (inner: unknown) => inner is T): boolean => value === undefined || is(value);
const isNullable = <T>(value: unknown, is: (inner: unknown) => inner is T): boolean => value === null || is(value);
const isListOf = <T>(value: unknown, is: (inner: unknown) => inner is T): value is T[] => Array.isArray(value) && value.every(is);
const isNumberPair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isNumber);

const MODULE_KINDS: readonly string[] = ['js', 'css', 'html', 'json', 'text'];

function isModule(value: unknown): value is StageModule {
  return isFields(value) && isString(value['name']) && isString(value['kind']) && MODULE_KINDS.includes(value['kind']) && isString(value['text']);
}

function isAsset(value: unknown): value is StageAsset {
  return (
    isFields(value) &&
    isString(value['name']) &&
    isString(value['mime']) &&
    isNumber(value['w']) &&
    isNumber(value['h']) &&
    (value['bytes'] instanceof ArrayBuffer || isString(value['url']))
  );
}

function isFace(value: unknown): value is StageFace {
  return (
    isFields(value) &&
    isString(value['family']) &&
    isString(value['url']) &&
    isString(value['weight']) &&
    isString(value['style']) &&
    isOptional(value['range'], isString) &&
    isOptional(value['box'], isNumberPair) &&
    isOptional(value['sample'], isString)
  );
}

function isFaces(value: unknown): value is StageFaces {
  if (!isFields(value) || !isListOf(value['fonts'], isFace)) return false;
  const slots = value['slots'];
  return isFields(slots) && ['sans', 'serif', 'mono', 'display'].every((stack) => isOptional(slots[stack], isString));
}

function isLimits(value: unknown): value is NarrationLimits {
  return isFields(value) && isNumber(value['maxLines']) && isNumber(value['maxLineSeconds']);
}

const isMode = (value: unknown): value is 'rough' | 'final' => value === 'rough' || value === 'final';

function isFilm(value: unknown): value is StageFilm {
  return (
    isFields(value) &&
    isString(value['script']) &&
    isListOf(value['modules'], isModule) &&
    isListOf(value['assets'], isAsset) &&
    isNullable(value['faces'], isFaces) &&
    isNullable(value['narration'], isLimits) &&
    isNumber(value['clippedTextWaitMs']) &&
    isMode(value['mode'])
  );
}

export function isStageConnect(value: unknown): value is StageConnect {
  return isFields(value) && value['type'] === STAGE_CONNECT && isNumber(value['version']);
}

/** Checked in the frame before any message is acted on. */
export function isHostToStage(value: unknown): value is HostToStage {
  if (!isFields(value) || !isString(value['type'])) return false;
  const message = value as Fields & { type: HostToStage['type'] };
  switch (message.type) {
    case 'load':
      return isFilm(message['film']);
    case 'render':
      return isNumber(message['seq']) && isNumber(message['t']) && isBoolean(message['playing']);
    case 'mode':
      return isMode(message['mode']);
    case 'frame':
      return (
        isNumber(message['seq']) &&
        isNumber(message['t']) &&
        isNumber(message['scale']) &&
        isBoolean(message['smallMedia']) &&
        isBoolean(message['readFx']) &&
        isBoolean(message['smooth'])
      );
    case 'watch':
      return isBoolean(message['on']) && isBoolean(message['places']);
    case 'scan':
      return true;
    case 'layers':
      return (
        isNumber(message['seq']) &&
        isNumber(message['from']) &&
        isNumber(message['to']) &&
        isNumber(message['at']) &&
        isNullable(message['scene'], isString) &&
        isBoolean(message['stop'])
      );
    case 'retouch':
      return isNullable(message['record'], isRetouchedRecord);
    case 'look':
      return isNumber(message['seq']) && isString(message['id']) && isNullable(message['t'], isNumber);
    default: {
      const never: never = message.type;
      void never;
      return false;
    }
  }
}

const isChapter = (value: unknown): value is Chapter<number> => isFields(value) && isNumber(value['t']) && isString(value['label']);

function isPart(value: unknown): value is FilmPart {
  return (
    isFields(value) &&
    isNullable(value['key'], isString) &&
    isString(value['label']) &&
    isString(value['own']) &&
    isNumber(value['a0']) &&
    isNumber(value['nat']) &&
    isNumber(value['p0']) &&
    isNumber(value['dur'])
  );
}

const SCENE_STATES: readonly string[] = ['todo', 'failed', 'rough', 'final'];
const isSceneReport = (value: unknown): value is SceneReport =>
  isFields(value) && isString(value['id']) && isString(value['state']) && SCENE_STATES.includes(value['state']);

function isMeta(value: unknown): value is StageMeta {
  const background = isFields(value) ? value['background'] : null;
  return (
    isFields(value) &&
    isNumber(value['width']) &&
    isNumber(value['height']) &&
    (value['fps'] === 24 || value['fps'] === 30 || value['fps'] === 60) &&
    isNumber(value['duration']) &&
    isNumber(value['filmDuration']) &&
    isListOf(value['chapters'], isChapter) &&
    isNullable(value['scenes'], (inner: unknown): inner is SceneReport[] => isListOf(inner, isSceneReport)) &&
    Array.isArray(background) &&
    background.length === 2 &&
    background.every(isString) &&
    isListOf(value['parts'], isPart)
  );
}

const SCORE_KINDS: readonly string[] = ['note', 'drum', 'fx'];
function isScoreEvent(value: unknown): boolean {
  return (
    isFields(value) &&
    isNumber(value['t']) &&
    isNumber(value['dur']) &&
    isString(value['kind']) &&
    SCORE_KINDS.includes(value['kind']) &&
    isString(value['patch']) &&
    isNumber(value['midi']) &&
    isNumber(value['vel']) &&
    (value['params'] === undefined || (isFields(value['params']) && Object.values(value['params']).every(isNumber)))
  );
}

function isScore(value: unknown): value is PlayedScore {
  if (!isFields(value) || !Array.isArray(value['events']) || !value['events'].every(isScoreEvent)) return false;
  const master = value['master'];
  const tempo = value['tempo'];
  return (
    isFields(master) &&
    isNumber(master['gain']) &&
    isNumber(master['fadeOut']) &&
    (master['loudness'] === undefined || isNullable(master['loudness'], isNumber)) &&
    (tempo === undefined || (isFields(tempo) && isNumber(tempo['bpm']) && isNumber(tempo['t0'])))
  );
}

function isNarration(value: unknown): value is NarrationReport {
  return (
    isFields(value) &&
    isNullable(value['duck'], isNumber) &&
    isListOf(value['lines'], (line: unknown): line is NarrationReport['lines'][number] =>
      isFields(line) && isNumber(line['at']) && isNumber(line['dur']) && isString(line['text']) && isString(line['audio']),
    )
  );
}

function isStageText(value: unknown): value is StageText {
  return (
    isFields(value) &&
    isString(value['text']) &&
    ['x', 'y', 'w', 'h', 'line'].every((key) => isOptional(value[key], isNumber)) &&
    isOptional(value['id'], isString) &&
    isOptional(value['seen'], isBoolean)
  );
}

const CONSOLE_LEVELS: readonly string[] = ['log', 'info', 'warn', 'error'];

/** Checked by the host: everything from the frame is the film's to forge. */
export function isStageToHost(value: unknown): value is StageToHost {
  if (!isFields(value) || !isString(value['type'])) return false;
  const message = value as Fields & { type: StageToHost['type'] };
  switch (message.type) {
    case 'hello':
      return isNumber(message['version']);
    case 'ready':
      return (
        isMeta(message['meta']) &&
        isNullable(message['score'], isScore) &&
        isNullable(message['narration'], isNarration) &&
        isNumber(message['loadMs'])
      );
    case 'presented':
      return isNumber(message['seq']) && isNumber(message['t']) && isBoolean(message['ok']) && isNumber(message['ms']);
    case 'frame':
      return (
        isNumber(message['seq']) &&
        isNumber(message['t']) &&
        isString(message['svg']) &&
        isNumber(message['pw']) &&
        isNumber(message['ph']) &&
        isNumber(message['ms'])
      );
    case 'frame-error':
      return isNumber(message['seq']) && isBoolean(message['hold']) && isBoolean(message['env']) && isString(message['message']);
    case 'console':
      return isString(message['level']) && CONSOLE_LEVELS.includes(message['level']) && isString(message['text']);
    case 'error':
      return (message['phase'] === 'load' || message['phase'] === 'render') && isString(message['message']) && isString(message['stack']);
    case 'navigating':
      return true;
    case 'texts':
      return isListOf(message['nodes'], isStageText);
    case 'layers':
      return isLayersReport(message['report']);
    case 'looked':
      return (
        isNumber(message['seq']) &&
        isString(message['id']) &&
        isNullable(message['look'], isAskedLook) &&
        isListOf(message['lost'], isString)
      );
    case 'link':
      return isString(message['href']);
    default: {
      const never: never = message.type;
      void never;
      return false;
    }
  }
}
