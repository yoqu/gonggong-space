/**
 * Runs export jobs on the WebAssembly module (`crates/open-artifact-export`). The
 * Worker runs them off the page's thread; where there are no Workers (Node
 * tests, the CLI) the client runs them here in-thread.
 *
 * The module's bytes are embedded, so it instantiates synchronously
 * wherever this runs.
 */

import * as glue from '../generated/open_artifact_export.js';
import { WASM_BASE64 } from '../generated/bytes.js';
import type { ExportBytes, Job, Progress } from './types.ts';

let ready = false;

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The module's exports, instantiating it on the first call. */
export function exportModule(): Omit<typeof glue, 'default' | 'initSync'> {
  if (!ready) {
    glue.initSync({ module: decode(WASM_BASE64) });
    ready = true;
  }
  return glue;
}

const encoder = new TextEncoder();

/** The bytes of an entry's data. */
async function bytesOf(data: ExportBytes): Promise<Uint8Array> {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

/** Names of files that are compressed already: stored, not deflated again. */
const COMPRESSED = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|br|woff2?|mp[34]|m4[av]|mov|webm|ogg|opus)$/i;

/** A URI safe to write as ASCII (as `encodeURI` writes it). */
function asciiUri(uri: string): string {
  try {
    return encodeURI(decodeURI(uri));
  } catch {
    try {
      return encodeURI(uri);
    } catch {
      return '';
    }
  }
}

const noNul = (text: string): string => text.replaceAll('\0', '');

async function runZip(job: Extract<Job, { kind: 'zip' }>, progress: Progress): Promise<Uint8Array> {
  const wasm = exportModule();
  const writer = new wasm.ZipWriter(job.time, job.date);
  try {
    const total = job.entries.length;
    for (const [index, entry] of job.entries.entries()) {
      let data = await bytesOf(entry.data);
      const png = /\.png$/i.test(entry.name);
      if (png && job.optimizePng) {
        const smaller = wasm.optimizePng(data, 9);
        if (smaller.length > 0) data = smaller;
      }
      const store = entry.store ?? COMPRESSED.test(entry.name);
      writer.add(entry.name, data, store ? 0 : job.level);
      progress(index + 1, total);
    }
    return writer.finish();
  } finally {
    writer.free();
  }
}

async function runPdf(job: Extract<Job, { kind: 'pdf' }>, progress: Progress): Promise<Uint8Array> {
  const wasm = exportModule();
  const writer = new wasm.PdfWriter();
  try {
    const total = job.pages.length;
    for (const [index, page] of job.pages.entries()) {
      const text = page.text ?? [];
      const links = page.links ?? [];
      writer.addPage(
        await bytesOf(page.jpeg),
        page.pixelWidth,
        page.pixelHeight,
        page.width,
        page.height,
        text.map((run) => noNul(run.text)).join('\0'),
        Float64Array.from(text.flatMap((run) => [run.x, run.baseline, run.size, run.width])),
        links.map((link) => noNul(asciiUri(link.uri))).join('\0'),
        Float64Array.from(links.flatMap((link) => [link.x, link.y, link.width, link.height])),
        page.bookmark || undefined,
      );
      progress(index + 1, total);
    }
    return writer.finish(job.title || undefined, job.date);
  } finally {
    writer.free();
  }
}

async function runPng(job: Extract<Job, { kind: 'png' }>): Promise<Uint8Array> {
  const data = await bytesOf(job.data);
  const smaller = exportModule().optimizePng(data, job.level);
  return smaller.length > 0 ? smaller : data;
}

/** Runs a job, reporting progress as entries or pages are packed. */
export function runJob(job: Job, progress: Progress = () => {}): Promise<Uint8Array> {
  switch (job.kind) {
    case 'zip':
      return runZip(job, progress);
    case 'pdf':
      return runPdf(job, progress);
    case 'png':
      return runPng(job);
  }
}
