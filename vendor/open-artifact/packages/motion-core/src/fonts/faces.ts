import { REFACED_MODULE } from '../names.ts';
import { FILM_FONT_FAMILY_NAMES, FONT_BOX_METRICS, FONT_SLOTS, resolveBuiltinFont, type BuiltinFont, type FontSlot } from './builtin.ts';
import type { PreparedFontFace } from './fetcher.ts';
import { readFilmFontSlots, readRefacedSlotValues, type FontModule } from './film-fonts.ts';

/** One `@font-face` the stage declares. */
export interface RenderFontFace {
  family: string;
  /** A weight or a weight range, `"400 700"`. */
  weight: string;
  style: 'normal' | 'italic';
  /** A `data:font/woff2;base64,…` URI. */
  url: string;
  range?: string;
  /** One character the face shows, to load it with. */
  sample?: string;
  axis?: string;
  /** Ascent and descent overrides, in percent. */
  box?: readonly [number, number];
}

/** Where a slot's faces come from: a built-in typeface, or a family's fetched files. */
export type FontSource = BuiltinFont | PreparedFontFace[];

const isBuiltinSource = (source: FontSource): source is BuiltinFont => !Array.isArray(source);

/** A built-in typeface's faces under a family name; `urlOf` gives each file's data URI. */
export function builtinFontFaces(font: BuiltinFont, family: string, urlOf: (file: string) => string): RenderFontFace[] {
  return font.files.map((file) => ({ family, weight: file.weight, style: file.style ?? 'normal', url: urlOf(file.file), box: FONT_BOX_METRICS }));
}

export function resolvedFontFaces(source: FontSource, family: string, urlOf: (file: string) => string): RenderFontFace[] {
  if (isBuiltinSource(source)) return builtinFontFaces(source, family, urlOf);
  return source.map((face) => ({
    family,
    weight: face.weight,
    style: 'normal',
    url: face.data,
    range: face.range,
    sample: face.sample,
    ...(face.axis !== undefined ? { axis: face.axis } : {}),
    box: FONT_BOX_METRICS,
  }));
}

/**
 * The typefaces a film is drawn with: each slot's family name on the stage, the faces to declare, `films` when the
 * film names a typeface of its own, `shipped` when a built-in typeface stands in for one (and whether it is the film's).
 */
export interface FilmFaces {
  slots: Partial<Record<FontSlot, string>>;
  fonts: RenderFontFace[];
  films: boolean;
  shipped: { films: boolean } | null;
}

/**
 * The faces for a film: a person's built-in picks first, then the families fetched for slots (`requested`), then the
 * film's own built-in names. Slots with the same source share one family name. `null` when no slot has a typeface.
 */
export function buildFilmFaces(
  modules: readonly FontModule[],
  urlOf: (file: string) => string,
  requested: Partial<Record<FontSlot, FontSource>> = {},
  usePicks = true,
): FilmFaces | null {
  const picks = readRefacedSlotValues(modules.find((module) => module.name === REFACED_MODULE)?.text);
  const [shown, authored] = usePicks ? [readFilmFontSlots(modules).faces, readFilmFontSlots(modules, 'film').faces] : [{}, {}];
  const pickedBuiltin = (slot: FontSlot): boolean => usePicks && resolveBuiltinFont(picks[slot]) !== undefined;
  const pickedFamily = (slot: FontSlot): boolean => picks[slot] !== undefined && resolveBuiltinFont(picks[slot]) === undefined;
  const sources: Partial<Record<FontSlot, FontSource>> = {};
  for (const slot of FONT_SLOTS) {
    const source: FontSource | undefined = pickedBuiltin(slot) ? shown[slot] : (requested[slot] ?? shown[slot]);
    if (source !== undefined) sources[slot] = source;
  }
  const filmNames = FONT_SLOTS.some((slot) => authored[slot] !== undefined || (requested[slot] !== undefined && !pickedFamily(slot)));
  const filmShipped = FONT_SLOTS.some((slot) => authored[slot] !== undefined && (pickedFamily(slot) || requested[slot] === undefined));
  const personShipped = usePicks && FONT_SLOTS.some((slot) => pickedBuiltin(slot) || (pickedFamily(slot) && requested[slot] === undefined));
  const filled = FONT_SLOTS.filter((slot) => sources[slot] !== undefined);
  if (filled.length === 0) return null;
  const firstWithSource = (slot: FontSlot): FontSlot => filled.find((other) => sources[other] === sources[slot])!;
  return {
    slots: Object.fromEntries(filled.map((slot) => [slot, FILM_FONT_FAMILY_NAMES[firstWithSource(slot)]])),
    fonts: filled
      .filter((slot) => firstWithSource(slot) === slot)
      .flatMap((slot) => resolvedFontFaces(sources[slot]!, FILM_FONT_FAMILY_NAMES[slot], urlOf)),
    films: filmNames,
    shipped: personShipped || filmShipped ? { films: filmShipped } : null,
  };
}

/** Each field is checked before it goes into css: some faces come from outside. */
const FACE_FIELDS = {
  family: /^[A-Za-z0-9 _-]{1,64}$/,
  url: /^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/,
  weight: /^[0-9]{1,4}(?: [0-9]{1,4})?$/,
  style: /^(?:normal|italic)$/,
  range: /^(?:U\+[0-9A-F]{1,6}(?:-[0-9A-F]{1,6})?(?:,(?=U)|$))*$/,
} as const;

/** The faces whose fields are all safe to write into css. */
export function usableFontFaces(faces: readonly unknown[]): RenderFontFace[] {
  return faces.filter((face): face is RenderFontFace => {
    if (typeof face !== 'object' || face === null) return false;
    const fields = face as Partial<Record<keyof typeof FACE_FIELDS, unknown>>;
    return (Object.keys(FACE_FIELDS) as Array<keyof typeof FACE_FIELDS>).every((key) =>
      key === 'range' && fields[key] === undefined ? true : typeof fields[key] === 'string' && FACE_FIELDS[key].test(fields[key]),
    );
  });
}

/** A face's `@font-face` rule, with a newline before it. */
export function fontFaceCss(face: RenderFontFace): string {
  return (
    `\n@font-face{font-family:"${face.family}";src:url(${face.url}) format("woff2");font-weight:${face.weight};font-style:${face.style}` +
    (face.range ? `;unicode-range:${face.range}` : '') +
    (face.box ? `;ascent-override:${Number(face.box[0])}%;descent-override:${Number(face.box[1])}%;line-gap-override:0%` : '') +
    ';font-display:block}'
  );
}

/** What `document.fonts.load` is given to load a face: a font shorthand and a text it shows. */
export function fontFaceProbe(face: RenderFontFace): [string, string] {
  return [`${face.style} ${face.weight.split(' ')[0]} 16px "${face.family}"`, typeof face.sample === 'string' && face.sample.length <= 2 ? face.sample : ' '];
}

/** A film's own font asset, declared under its file name's stem. */
export function fontAssetFamily(assetName: string): string {
  return assetName.replace(/\.[a-z0-9]+$/i, '').replace(/["\\]/g, '');
}

export const fontAssetCss = (assetName: string, url: string): string => `\n@font-face{font-family:"${fontAssetFamily(assetName)}";src:url(${url});font-display:block}`;

/** The system's fonts for each running-text slot. */
export const SYSTEM_FONT_STACKS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

/**
 * Each slot's font-family stack: a filled slot's family ahead of the system stack (display ahead of the sans
 * stack); display with no typeface of its own is the sans stack with its first family twice, which draws the same
 * and can still be told apart.
 */
export function fontStacks(slots: Partial<Record<FontSlot, string>>): { stacks: Record<FontSlot, string>; filled: FontSlot[] } {
  const filled = FONT_SLOTS.filter((slot) => typeof slots[slot] === 'string');
  const named = (slot: FontSlot): string | undefined => {
    const family = slots[slot];
    return family === undefined ? undefined : `"${family.replace(/["\\]/g, '')}", `;
  };
  const sans = (named('sans') ?? '') + SYSTEM_FONT_STACKS.sans;
  const serif = (named('serif') ?? '') + SYSTEM_FONT_STACKS.serif;
  const mono = (named('mono') ?? '') + SYSTEM_FONT_STACKS.mono;
  const display = named('display') !== undefined ? named('display') + sans : `${/^("[^"]*"|[^,]*)/.exec(sans)![0]}, ${sans}`;
  return { stacks: { sans, serif, mono, display }, filled };
}

/**
 * The stacks as css custom properties, for css modules that cannot read the kit: --sans always, the others where a
 * slot is filled. In `:where(:root)`, so that a film's own property of the name wins.
 */
export function stackCss(stacks: Record<FontSlot, string>, filled: readonly FontSlot[]): string {
  return `:where(:root){${['sans' as const, ...filled.filter((slot) => slot !== 'sans')].map((slot) => `--${slot}:${stacks[slot]}`).join(';')}}`;
}
