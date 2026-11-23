/**
 * What the export packer takes and the messages between the page and its
 * Worker.
 */

/** Bytes as the editors have them: in memory, as text (written as UTF-8), or a Blob (read in the Worker). */
export type ExportBytes = Uint8Array | string | Blob;

/** One file in a zip. */
export interface ZipEntry {
  name: string;
  data: ExportBytes;
  /** Store the entry as it is (already compressed data). By default entries are deflated unless their name says they are compressed (PNG, JPEG, fonts…). */
  store?: boolean;
}

/** Options of a zip. */
export interface ZipOptions {
  /** Modification time of every entry (default: now). */
  date?: Date;
  /** Deflate level, 1–10 (default 6). */
  level?: number;
  /** Re-compress `.png` entries losslessly before storing them (default: no). */
  optimizePng?: boolean;
}

/** A run of invisible text: one line of words as rendered. */
export interface PdfTextRun {
  text: string;
  /** Left edge, pt from the page's left. */
  x: number;
  /** Baseline, pt from the page's top. */
  baseline: number;
  /** Font size in pt. */
  size: number;
  /** Rendered width in pt (the run is stretched to it). */
  width: number;
}

/** A clickable area that opens a web address (http, https or mailto; others are left out). */
export interface PdfLink {
  uri: string;
  /** Top-left corner and size, in pt from the page's top left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One page: a JPEG filling the page, the page size in points, and what lies over it. */
export interface PdfPage {
  jpeg: Uint8Array | Blob;
  /** Pixel size of the JPEG. */
  pixelWidth: number;
  pixelHeight: number;
  /** Page size in points (1/72 inch). */
  width: number;
  height: number;
  /** Invisible, selectable text. */
  text?: readonly PdfTextRun[];
  links?: readonly PdfLink[];
  /** Title of the page's entry in the document outline. */
  bookmark?: string;
}

/** Options of a PDF. */
export interface PdfOptions {
  title?: string;
  /** Creation time (default: now). */
  date?: Date;
}

/** Options of a PNG re-compression. */
export interface PngOptions {
  /** Deflate level, 1–10 (default 9). */
  level?: number;
}

/** Reports how much of a job is done (entries or pages). */
export type Progress = (done: number, total: number) => void;

/** A job as it travels to the Worker. */
export type Job =
  | { kind: 'zip'; entries: readonly ZipEntry[]; time: number; date: number; level: number; optimizePng: boolean }
  | { kind: 'pdf'; pages: readonly PdfPage[]; title: string | undefined; date: number }
  | { kind: 'png'; data: Uint8Array | Blob; level: number };

/** Page → Worker. */
export interface JobMessage {
  id: number;
  job: Job;
}

/** Worker → page. */
export type WorkerMessage =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; bytes: Uint8Array }
  | { id: number; type: 'failed'; message: string; fatal: boolean };
