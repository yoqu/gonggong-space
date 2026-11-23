/**
 * Typefaces for the font menus' names, each set in its own face: built-ins from the page's own font files, Google
 * families from their small preview files. Faces load under names of their own ({@link builtinPreviewFamilyName}),
 * apart from the stage's. Loaded once for the page's life; components follow {@link useFontPreviews}.
 */

import { create } from 'zustand';
import {
  COMMON_GOOGLE_FONT_NAMES,
  builtinFontFileUrl,
  builtinPreviewFamilyName,
  fetchGoogleFontPreviews,
  googlePreviewFamilyName,
  type BuiltinFont,
  type BuiltinFontFile,
} from '@open-artifact/motion-core';

/** The weight the names are set in. */
export const PREVIEW_WEIGHT = 600;
/** Common families asked for in one request, at most. */
const PREVIEW_BATCH = 12;

/** Preview family names that have loaded. */
export const useFontPreviews = create<{ loaded: ReadonlySet<string> }>()(() => ({ loaded: new Set() }));

const asked = new Set<string>();

function markLoaded(family: string): void {
  useFontPreviews.setState((state) => ({ loaded: new Set([...state.loaded, family]) }));
}

const weightRange = (weight: string): [number, number] => {
  const [low, high] = weight.split(/\s+/).map(Number);
  const from = Number.isFinite(low) ? (low ?? 400) : 400;
  return [from, Number.isFinite(high) ? (high ?? from) : from];
};

/** The upright file that covers the preview weight, else the first upright one. */
export function previewFile(font: Pick<BuiltinFont, 'files'>): BuiltinFontFile | undefined {
  const upright = font.files.filter((file) => file.style !== 'italic');
  return (
    upright.find((file) => {
      const [low, high] = weightRange(file.weight);
      return low <= PREVIEW_WEIGHT && PREVIEW_WEIGHT <= high;
    }) ?? upright[0]
  );
}

async function addFace(face: FontFace): Promise<boolean> {
  try {
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

/** Loads a built-in typeface's preview face. */
export function loadBuiltinPreview(font: BuiltinFont): void {
  const family = builtinPreviewFamilyName(font);
  if (asked.has(family) || typeof FontFace === 'undefined') return;
  asked.add(family);
  const file = previewFile(font);
  if (file === undefined) return;
  const face = new FontFace(family, `url("${builtinFontFileUrl(file.file).href}")`, { weight: file.weight, style: 'normal' });
  void addFace(face).then((ok) => {
    if (ok) markLoaded(family);
    else asked.delete(family);
  });
}

async function fetchPreviews(families: readonly string[]): Promise<void> {
  let previews: Awaited<ReturnType<typeof fetchGoogleFontPreviews>>;
  try {
    previews = await fetchGoogleFontPreviews(families);
  } catch {
    previews = [];
  }
  const came = new Set<string>();
  await Promise.all(
    previews.map(async ({ family, bytes }) => {
      const name = googlePreviewFamilyName(family);
      if (await addFace(new FontFace(name, bytes.slice(), { weight: String(PREVIEW_WEIGHT) }))) {
        came.add(family);
        markLoaded(name);
      }
    }),
  );
  for (const family of families) if (!came.has(family)) asked.delete(googlePreviewFamilyName(family));
}

const common = new Set(COMMON_GOOGLE_FONT_NAMES);

/** Loads Google families' preview faces: the common ones together, any other alone. */
export function loadGooglePreviews(families: readonly string[]): void {
  if (typeof FontFace === 'undefined') return;
  const wanted = families.filter((family) => !asked.has(googlePreviewFamilyName(family)));
  for (const family of wanted) asked.add(googlePreviewFamilyName(family));
  const batched = wanted.filter((family) => common.has(family));
  for (let at = 0; at < batched.length; at += PREVIEW_BATCH) void fetchPreviews(batched.slice(at, at + PREVIEW_BATCH));
  for (const family of wanted.filter((name) => !common.has(name))) void fetchPreviews([family]);
}

/** The CSS font stack an option's name is set in, once its preview face loaded. */
export function previewFontFamily(loaded: ReadonlySet<string>, option: { face: BuiltinFont | null; google: boolean; name: string }): string | undefined {
  const family = option.face !== null ? builtinPreviewFamilyName(option.face) : option.google ? googlePreviewFamilyName(option.name) : null;
  return family !== null && loaded.has(family) ? `"${family}", system-ui, sans-serif` : undefined;
}
