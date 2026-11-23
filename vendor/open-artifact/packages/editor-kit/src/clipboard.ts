/**
 * Writing the system clipboard from an editor. Some browsers keep the
 * clipboard from framed pages whatever the frame's `allow` says; there the
 * Open Artifact Shell framing the editor writes instead (it may, right after
 * a press in the frame). Pure (no DOM until called).
 */

import type { ShellConnection } from '@open-artifact/runtime';

/** The browser itself writes clipboard formats (images, HTML) here. */
const browserWrites = (): boolean => typeof ClipboardItem !== 'undefined' && Boolean(globalThis.navigator?.clipboard?.write);

/** The browser refused the clipboard (rather than failing on the content). */
export function clipboardRefused(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'NotAllowedError';
}

/** Formats can be copied: by the browser, or by the Shell framing the page. */
export function canWriteClipboard(shell?: ShellConnection | null): boolean {
  return browserWrites() || Boolean(shell?.writesClipboard);
}

/**
 * Writes one clipboard item. Call it on the person's press without awaiting
 * anything first (a format may still be a promise, such as an image being
 * drawn). Where the browser refuses this page, the Shell writes it.
 */
export async function writeClipboard(items: Record<string, Blob | PromiseLike<Blob>>, shell?: ShellConnection | null): Promise<void> {
  if (browserWrites()) {
    try {
      await navigator.clipboard.write([new ClipboardItem(items)]);
      return;
    } catch (error) {
      if (!shell?.writesClipboard || !clipboardRefused(error)) throw error;
    }
  } else if (!shell?.writesClipboard) {
    throw new Error('This browser cannot copy to the clipboard.');
  }
  await shell.writeClipboard(items);
}

/** Writes text to the clipboard, through the Shell where the browser refuses this page. */
export async function writeClipboardText(text: string, shell?: ShellConnection | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    if (!shell?.writesClipboard || !clipboardRefused(error)) throw error;
    await shell.writeClipboard({ 'text/plain': new Blob([text], { type: 'text/plain' }) });
  }
}
