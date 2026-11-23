export const FALLBACK_FILE_STEM = 'video';
const MAX_STEM_CHARS = 60;
/** A downloaded file's name, less its extension, in code points. */
const MAX_NAME_CODE_POINTS = 120;
/**
 * What a file name leaves out: control, format and other invisible characters, lone surrogates, line and paragraph
 * separators, and a few that draw blank or not at all (the blank Braille pattern, the object replacement character,
 * the Egyptian hieroglyph format controls and the musical null notehead).
 */
const UNSEEN = /[\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u0000-\u001f\u007f-\u009f⠀￼\u{13441}\u{13442}\u{1d159}]/gu;
/** Characters a file system or a download refuses, each run of them taken as a space. */
const RESERVED = /[/\\:*?"<>|%]+/g;

/**
 * The title as an ASCII stem: lower case, plain letters and digits joined by dashes. For names that must stay plain,
 * as the source folder's root.
 */
export function exportFileStem(title: string): string {
  const stem = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_STEM_CHARS)
    .replace(/-+$/, '');
  return stem === '' ? FALLBACK_FILE_STEM : stem;
}

/**
 * The title as a downloaded file's name, then the extension. Case, letters of any script and spaces are kept; what a
 * file name cannot hold or would not show goes, whitespace runs become one space, leading and trailing dots and spaces
 * go, and the name is cut to 120 code points. A title with nothing left is named `video`.
 */
export function downloadFileName(title: string, extension: string): string {
  const kept = title
    .replace(/[\t\n\r]/g, ' ')
    .replace(UNSEEN, '')
    .replace(RESERVED, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const name = Array.from(kept).slice(0, MAX_NAME_CODE_POINTS).join('').replace(/[\s.]+$/, '');
  return (name === '' ? FALLBACK_FILE_STEM : name) + '.' + extension;
}

/** An exported file's name: the video, MOV, GIF, standalone page and source folder all keep the title. */
export const exportFilename = (title: string, extension: string): string => downloadFileName(title, extension);
