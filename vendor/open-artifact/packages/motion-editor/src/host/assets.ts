/**
 * An asset's bytes, from its ref: `_blob/<id>` is fetched from the origin's root (where the host serves blobs),
 * a `data:` URI is decoded. Bytes are kept by ref, so a film that changes only its code fetches nothing again.
 */

import { BLOB_REFERENCE_PATTERN } from '@open-artifact/motion-core';

const MAX_KEPT = 200;
const kept = new Map<string, Promise<ArrayBuffer | null>>();

/** The URL a blob ref is served at, absolute so a sandboxed frame can stream it too. */
export function assetUrl(ref: string): string | null {
  if (ref.startsWith('data:')) return ref;
  if (!BLOB_REFERENCE_PATTERN.test(ref)) return null;
  return new URL(`/${ref}`, location.href).href;
}

async function load(ref: string): Promise<ArrayBuffer | null> {
  const url = assetUrl(ref);
  if (url === null) return null;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/** The bytes of an asset ref, or `null` when they cannot be had. The returned buffer is shared: copy before transferring. */
export function assetBytes(ref: string): Promise<ArrayBuffer | null> {
  const known = kept.get(ref);
  if (known !== undefined) return known;
  const loading = load(ref);
  kept.set(ref, loading);
  // A failed load is tried again next time.
  void loading.then((bytes) => {
    if (bytes === null) kept.delete(ref);
  });
  if (kept.size > MAX_KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  return loading;
}
