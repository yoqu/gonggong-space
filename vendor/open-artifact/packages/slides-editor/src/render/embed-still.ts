import type { EmbedNode } from '@open-artifact/slides-core';

/** The CSP every embed page runs under: no network, inline code only. */
export const EMBED_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** The document an embed's iframe loads. */
export function embedDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EMBED_CSP}"><style>html,body{margin:0;background:transparent}</style></head><body>${html}</body></html>`;
}

/** Runs inside an opaque sandbox. Only a raster image crosses back into the editor. */
function renderStill(): void {
  window.addEventListener('message', async event => {
    const port = event.ports[0];
    if (event.source !== parent || !port || event.data !== 'capture') return;
    try {
      await document.fonts.ready;
      await new Promise(resolve => setTimeout(resolve, 250));
      const copy = document.documentElement.cloneNode(true) as HTMLElement;
      for (const [i, canvas] of Array.from(copy.querySelectorAll('canvas')).entries()) {
        const picture = document.createElement('img');
        picture.src = document.querySelectorAll('canvas')[i]!.toDataURL();
        for (const attr of canvas.attributes) picture.setAttribute(attr.name, attr.value);
        canvas.replaceWith(picture);
      }
      copy.querySelectorAll('script,meta,iframe,link,object').forEach(el => el.remove());
      const width = innerWidth;
      const height = innerHeight;
      copy.style.width = width + 'px';
      copy.style.height = height + 'px';
      // Body backgrounds normally paint the viewport, including when the body is empty.
      const bodyColor = getComputedStyle(document.body).backgroundColor;
      const html = new XMLSerializer().serializeToString(copy);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await image.decode();
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 2560 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d')!;
      if (getComputedStyle(document.documentElement).backgroundColor === 'rgba(0, 0, 0, 0)') {
        ctx.fillStyle = bodyColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => port.postMessage(blob), 'image/png');
    } catch {
      port.postMessage(null);
    }
  });
}

/** Capture at layout size so responsive embeds match their on-stage appearance. */
async function captureEmbed(html: string, width: number, height: number): Promise<Blob | null> {
  if (!width || !height) return null;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', left: '-100000px', top: '0', border: '0', width: width + 'px', height: height + 'px' });
  const channel = new MessageChannel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Blob | null>(resolve => {
      timer = setTimeout(() => resolve(null), 3500);
      channel.port1.onmessage = event => {
        const blob: unknown = event.data;
        resolve(blob instanceof Blob && blob.type === 'image/png' && blob.size <= 16 * 1024 * 1024 ? blob : null);
      };
      frame.onload = () => {
        frame.onload = null;
        frame.contentWindow?.postMessage('capture', '*', [channel.port2]);
      };
      frame.srcdoc = embedDocument(`<script>(${renderStill.toString()})()<\/script>${html}`);
      document.body.append(frame);
    });
  } finally {
    clearTimeout(timer);
    channel.port1.close();
    channel.port2.close();
    frame.remove();
  }
}

const captures = new WeakMap<EmbedNode, { width: number; height: number; blob: Promise<Blob | null> }>();
const pending = new WeakMap<HTMLElement, Promise<boolean>>();
const slots = Array.from({ length: 4 }, () => Promise.resolve());
let nextSlot = 0;

function stillFor(node: EmbedNode, width: number, height: number): Promise<Blob | null> {
  const cached = captures.get(node);
  if (cached && cached.width === width && cached.height === height) return cached.blob;
  const slot = nextSlot++ % slots.length;
  const blob = slots[slot]!.then(() => captureEmbed(node.html, width, height)).catch(() => null);
  slots[slot] = blob.then(image => {
    if (!image && captures.get(node)?.blob === blob) captures.delete(node);
  });
  captures.set(node, { width, height, blob });
  return blob;
}

/** A thumbnail and an export share the same still at the same layout size. */
export function mountEmbedStill(holder: HTMLElement, node: EmbedNode): () => void {
  let image: HTMLImageElement | undefined;
  let request = 0;
  let width = -1, height = -1;
  function update(): void {
    if (width === holder.offsetWidth && height === holder.offsetHeight) return;
    width = holder.offsetWidth;
    height = holder.offsetHeight;
    const current = ++request;
    pending.set(holder, stillFor(node, width, height).then(blob => {
      if (current !== request || !blob) return false;
      if (!image) {
        image = new Image();
        image.alt = '';
        image.style.cssText = 'width:100%;height:100%;display:block';
        holder.append(image);
      } else URL.revokeObjectURL(image.src);
      image.src = URL.createObjectURL(blob);
      holder.classList.remove('open-artifact-embed-still');
      return true;
    }));
  }
  update();
  const observer = new ResizeObserver(update);
  observer.observe(holder);
  return () => {
    request++;
    observer.disconnect();
    if (image) { URL.revokeObjectURL(image.src); image.remove(); }
    holder.classList.add('open-artifact-embed-still');
    pending.delete(holder);
  };
}

export async function embedStillsReady(root: HTMLElement): Promise<boolean[]> {
  const holders = root.querySelectorAll<HTMLElement>('[data-open-artifact-kind="embed"]');
  return Promise.all(Array.from(holders, holder => pending.get(holder) ?? false));
}
