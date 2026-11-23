import type { StageAsset } from '../protocol.ts';
import { addFontAsset } from './fonts.ts';

interface HeldAsset {
  url: string;
  mime: string;
  bytes: ArrayBuffer | null;
  w: number;
  h: number;
}

const assets = new Map<string, HeldAsset>();
const images = new Map<string, Promise<HTMLImageElement>>();
const CHUNK = 0x8000;

export function dataUrl(mime: string, bytes: ArrayBuffer): string {
  const all = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < all.length; i += CHUNK) text += String.fromCharCode(...all.subarray(i, Math.min(i + CHUNK, all.length)));
  return 'data:' + mime + ';base64,' + btoa(text);
}

/** Pictures and fonts become data: URLs, which a snapshot can see; a clip keeps its URL and streams. */
export function addAssets(list: readonly StageAsset[]): void {
  for (const asset of list) {
    const url = asset.bytes ? dataUrl(asset.mime, asset.bytes) : asset.url;
    if (url === undefined) continue;
    assets.set(asset.name, { url, mime: asset.mime, bytes: asset.bytes ?? null, w: asset.w, h: asset.h });
    if (/^font\//.test(asset.mime)) addFontAsset(asset.name, url);
  }
}

export const assetUrl = (name: string): string | null => assets.get(name)?.url ?? null;

export interface AssetStore {
  has(name: string): boolean;
  list(): string[];
  url(name: string): string;
  mime(name: string): string;
  bytes(name: string): Uint8Array | null;
  text(name: string): string | null;
  image(name: string): Promise<HTMLImageElement>;
  size(name: string): { w: number; h: number } | null;
}

export const assetStore: AssetStore = {
  has: (name) => assets.has(name),
  list: () => [...assets.keys()],
  url(name) {
    const asset = assets.get(name);
    if (asset) return asset.url;
    console.error('kit.assets: no asset ' + name);
    return '';
  },
  mime: (name) => assets.get(name)?.mime ?? '',
  bytes(name) {
    const bytes = assets.get(name)?.bytes;
    return bytes ? new Uint8Array(bytes.slice(0)) : null;
  },
  text(name) {
    const bytes = assets.get(name)?.bytes;
    return bytes ? new TextDecoder().decode(bytes) : null;
  },
  image(name) {
    const cached = images.get(name);
    if (cached) return cached;
    const asset = assets.get(name);
    if (!asset) return Promise.reject(new Error('no asset ' + name));
    const loading = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('asset ' + name + ' did not decode'));
      image.src = asset.url;
    });
    images.set(name, loading);
    return loading;
  },
  size(name) {
    const asset = assets.get(name);
    return asset && asset.w ? { w: asset.w, h: asset.h } : null;
  },
};
