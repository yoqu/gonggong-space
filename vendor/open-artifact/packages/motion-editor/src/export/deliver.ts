/**
 * Hands a finished file over. The host's `downloads` saves on the sharing computer and says where, but takes a file of
 * 512 MB at most; a larger one, or one the host has no `downloads` for, goes to the browser's own downloads through a
 * link to the file's object URL.
 */

import { browserDownload, saveFile } from '@open-artifact/editor-kit';
import type { DownloadsCapability } from '@open-artifact/runtime';
import type { ExportedFile } from '@open-artifact/motion-export';

/** The most a host's `downloads.save` takes. */
export const HOST_SAVE_MAX_BYTES = 512 * 1_048_576;

/** A video stays readable for this long after its download link was clicked: a large file takes the browser a while. */
const LARGE_FILE_KEEP_MS = 10 * 60_000;

export type Delivery = { to: 'host'; savedTo: string | null } | { to: 'browser' };

/**
 * Where a file of this size goes. A host that saves in the browser (`inBrowser`, a cloud host) takes any size: the
 * file reaches it as the same Blob and becomes the browser's own download there.
 */
export const deliveryRoute = (bytes: number, hostSaves: boolean, inBrowser = false): 'host' | 'browser' => (hostSaves && (inBrowser || bytes <= HOST_SAVE_MAX_BYTES) ? 'host' : 'browser');

/** Saves the file; rejects when the host refuses it (the caller may then offer the browser download). */
export async function deliverFile(file: ExportedFile, downloads: DownloadsCapability | null): Promise<Delivery> {
  if (deliveryRoute(file.blob.size, downloads !== null, downloads?.browser === true) === 'host' && downloads !== null) {
    const saved = await saveFile(downloads, file.filename, file.blob);
    // A host that saves in the browser put it in the browser's downloads: say so, as for a download of the page's own.
    if (downloads.browser === true) return { to: 'browser' };
    return saved.to === 'host' ? { to: 'host', savedTo: saved.savedTo ?? null } : { to: 'browser' };
  }
  browserDownload(file.filename, file.blob, LARGE_FILE_KEEP_MS);
  return { to: 'browser' };
}

/** The browser download, when the host would not take the file. */
export function downloadInBrowser(file: ExportedFile): Delivery {
  browserDownload(file.filename, file.blob, LARGE_FILE_KEEP_MS);
  return { to: 'browser' };
}
