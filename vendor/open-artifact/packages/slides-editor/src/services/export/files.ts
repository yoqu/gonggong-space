/**
 * Export file names and saving.
 *
 * Files are saved through the host's downloads capability when it has one
 * and the file fits its 16 MB limit; otherwise the page starts an ordinary
 * browser download (up to 200 MB, which is what a tab can reliably hand
 * over). A host that saves in the browser (a cloud host) takes every file
 * up to that 200 MB.
 */

import { browserDownload } from '@open-artifact/editor-kit';

/** Largest file the downloads capability takes. */
export const CAPABILITY_LIMIT = 16 * 1024 * 1024;
/** Largest file a browser download is attempted for. */
export const BROWSER_LIMIT = 200 * 1024 * 1024;
/** Longest base name, in characters. */
const NAME_CHARS = 120;
/** Longest whole file name, in UTF-8 bytes (file systems allow 255). */
const NAME_BYTES = 240;
/** Base name of a deck without a usable title. */
const FALLBACK = 'presentation';

const utf8 = (text: string): number => new TextEncoder().encode(text).length;

/** Cuts text to at most `max` code points, then to `bytes` UTF-8 bytes. */
function cut(text: string, max: number, bytes: number): string {
  let out = [...text].slice(0, max).join('');
  while (out && utf8(out) > bytes) out = [...out].slice(0, -1).join('');
  return out;
}

/** A deck title as a file base name: no reserved characters, at most 120 characters. */
export function fileBase(title: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return cut(cleaned, NAME_CHARS, NAME_BYTES).trim() || FALLBACK;
}

/** `Title.ext`, kept within the byte limit. */
export function exportFileName(title: string, extension: string): string {
  const suffix = `.${extension}`;
  return `${cut(fileBase(title), NAME_CHARS, NAME_BYTES - utf8(suffix)).trim() || FALLBACK}${suffix}`;
}

/** `Title-slide-N.ext` for one slide. */
export function slideFileName(title: string, number: number, extension: string): string {
  const suffix = `-slide-${number}.${extension}`;
  return `${cut(fileBase(title), NAME_CHARS, NAME_BYTES - utf8(suffix)).trim() || FALLBACK}${suffix}`;
}

/** "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Saves through the host. */
export interface FileSaver {
  save(file: { name: string; data: Blob }): Promise<{ savedTo?: string }>;
  /** It saves in the browser (a cloud host): any size a browser download takes, and every file goes through it. */
  readonly browser?: boolean;
}

/**
 * Saves an export: through `saver` when given and the file is small enough,
 * else as a browser download. Rejects with a readable error when the file
 * is too large or the host refuses it.
 */
export async function saveExport(name: string, blob: Blob, saver: FileSaver | null): Promise<{ savedTo?: string; browser: boolean }> {
  if (saver?.browser === true && blob.size > BROWSER_LIMIT) {
    throw new Error(`The file is ${formatBytes(blob.size)}, more than the ${formatBytes(BROWSER_LIMIT)} a download can hold. Try a lower quality or fewer slides.`);
  }
  if (saver && (blob.size <= CAPABILITY_LIMIT || saver.browser === true)) {
    try {
      const result = await saver.save({ name, data: blob });
      return { ...result, browser: false };
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : String(error);
      throw new Error(`The file could not be saved: ${reason}`);
    }
  }
  if (blob.size > BROWSER_LIMIT) {
    throw new Error(`The file is ${formatBytes(blob.size)}, more than the ${formatBytes(BROWSER_LIMIT)} a download can hold. Try a lower quality or fewer slides.`);
  }
  try {
    browserDownload(name, blob);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : String(error);
    throw new Error(`The download could not start: ${reason}`);
  }
  return { browser: true };
}
