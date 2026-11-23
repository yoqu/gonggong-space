import { MAX_RETOUCHED_LAYERS, RETOUCH_PROPERTIES, TEXT_ALIGNS, isRetouchParts, parseRetouchLayer } from '@open-artifact/motion-core';
import type { RetouchedRecord } from '@open-artifact/motion-core';
import type { AskedLook, LayerBox, LayerLook, LayerMotion, LayerRow, LayersReport } from './layers.ts';

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNullable = <T>(value: unknown, is: (inner: unknown) => inner is T): boolean => value === null || is(value);
const isListOf = <T>(value: unknown, is: (inner: unknown) => inner is T): value is T[] => Array.isArray(value) && value.every(is);
const isNumberPair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isNumber);
const isBox = (value: unknown): value is LayerBox => Array.isArray(value) && value.length === 4 && value.every(isNumber);
const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const isColor = (value: unknown): value is string => isString(value) && COLOR.test(value);
const isOneOf =
  (all: readonly string[]) =>
  (value: unknown): value is string =>
    isString(value) && all.includes(value);

const LAYER_KINDS: readonly string[] = ['ground', 'group', 'shape', 'image', 'text'];
const LAYER_DRAWN: readonly string[] = ['', 'graphic', 'drawing', 'group', 'line', 'path', 'polygon'];
const LAYER_EFFECTS: readonly string[] = ['fade', 'grow', 'left', 'right', 'top', 'bottom'];
const PROPERTIES: readonly string[] = RETOUCH_PROPERTIES;
const ALIGNS: readonly string[] = TEXT_ALIGNS;

function isMotion(value: unknown): value is LayerMotion {
  return isFields(value) && isNullable(value['how'], (how: unknown): how is string[] => isListOf(how, isOneOf(LAYER_EFFECTS))) && isNumber(value['from']) && isNumber(value['to']);
}

function isLayerLook(value: unknown): value is LayerLook {
  return (
    isFields(value) &&
    isString(value['cls']) &&
    isNullable(value['kin'], isString) &&
    (value['parts'] === undefined || isRetouchParts(value['parts'])) &&
    isNumber(value['at']) &&
    ['fill', 'ink', 'svgfill', 'svgstroke'].every((key) => isNullable(value[key], isColor)) &&
    isNullable(value['radius'], isNumber) &&
    isNumber(value['most']) &&
    isNullable(value['size'], isNumber) &&
    (value['hidden'] === 0 || value['hidden'] === null) &&
    (value['filled'] === undefined || value['filled'] === true) &&
    isNullable(value['entry'], isString) &&
    isBoolean(value['loose']) &&
    isBoolean(value['home']) &&
    isListOf(value['lapsed'], isOneOf(PROPERTIES))
  );
}

export function isLayerRow(value: unknown): value is LayerRow {
  return (
    isFields(value) &&
    isString(value['id']) &&
    isOneOf(LAYER_KINDS)(value['kind']) &&
    isBoolean(value['round']) &&
    isString(value['name']) &&
    (value['hidden'] === 'held' || value['hidden'] === 'own' || value['hidden'] === false) &&
    isNullable(value['under'], isString) &&
    isBoolean(value['own']) &&
    isNumber(value['many']) &&
    isListOf(value['texts'], isString) &&
    isListOf(value['spans'], isNumberPair) &&
    isNumber(value['at']) &&
    isMotion(value['enter']) &&
    isMotion(value['leave']) &&
    isNullable(value['box'], isBox) &&
    isNullable(value['wordsBox'], isBox) &&
    isNullable(value['look'], isLayerLook) &&
    isListOf(value['kids'], isLayerRow) &&
    isNullable(value['sole'], isLayerRow) &&
    isBoolean(value['whole']) &&
    isOneOf(LAYER_DRAWN)(value['drawn']) &&
    isBoolean(value['full'])
  );
}

export function isLayersReport(value: unknown): value is LayersReport {
  return (
    isFields(value) &&
    isNumber(value['seq']) &&
    isNumber(value['from']) &&
    isNumber(value['to']) &&
    isNumber(value['at']) &&
    isListOf(value['lost'], isString) &&
    isListOf(value['underHide'], isString) &&
    isNullable(value['rows'], (rows: unknown): rows is LayerRow[] => isListOf(rows, isLayerRow))
  );
}

export function isAskedLook(value: unknown): value is AskedLook {
  return (
    isFields(value) &&
    isNullable(value['weight'], isNumber) &&
    (value['italic'] === 0 || value['italic'] === 1 || value['italic'] === null) &&
    isNullable(value['px'], isNumber) &&
    (value['leading'] === 'normal' || isNullable(value['leading'], isNumber)) &&
    isNullable(value['tracking'], isNumber) &&
    isNullable(value['align'], isOneOf(ALIGNS)) &&
    isString(value['cls']) &&
    isNullable(value['kin'], isString) &&
    isNumber(value['at']) &&
    isNullable(value['fill'], isColor) &&
    isNullable(value['ink'], isColor) &&
    isNullable(value['radius'], isNumber) &&
    isNumber(value['most']) &&
    isNullable(value['size'], isNumber) &&
    (value['hidden'] === 0 || value['hidden'] === null) &&
    isNullable(value['entry'], isString) &&
    isBoolean(value['home']) &&
    isListOf(value['lapsed'], isOneOf(PROPERTIES)) &&
    isString(value['family'])
  );
}

/** A record as `parseRetouchedRecord` gives it: each entry one the player would keep. The frame parses it again. */
export function isRetouchedRecord(value: unknown): value is RetouchedRecord {
  return isFields(value) && Array.isArray(value['layers']) && value['layers'].length <= MAX_RETOUCHED_LAYERS && value['layers'].every((layer: unknown) => parseRetouchLayer(layer) !== null);
}
