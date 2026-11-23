import { fileURLToPath } from 'node:url';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { inScript } from './host.ts';
import { OFFLINE_RUNTIME_ID } from './offline/data.ts';

export interface BuiltScript {
  script: string;
  /** Absolute paths of the source files that went into it, for a dev server to watch. */
  inputs: string[];
}

const here = fileURLToPath(new URL('.', import.meta.url));
const entryExtension = extname(fileURLToPath(import.meta.url));

/** Both scripts run as classic scripts: the stage in a srcdoc frame, the player in a page saved to disk. */
async function bundle(entry: string): Promise<BuiltScript> {
  const result = await build({
    entryPoints: [resolve(here, entry.replace(/\.ts$/, entryExtension))],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
    absWorkingDir: here,
    metafile: true,
    // A classic script has no import.meta: the model's font file URLs, which the stage never reads, are made against a base that parses.
    define: { 'import.meta.url': '"file:///"' },
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('esbuild gave no output for ' + entry);
  const inputs = Object.keys(result.metafile.inputs).map((input) => resolve(here, input));
  return { script: output.text, inputs };
}

/** The stage runtime built afresh, with its inputs: for a dev server, which builds it again when one changes. */
export const buildStageRuntimeFresh = (): Promise<BuiltScript> => bundle('./runtime/main.ts');

let runtime: Promise<string> | null = null;
let player: Promise<string> | null = null;

/** The stage runtime, the script the frame runs before any film code: built once per process. */
export function buildStageRuntime(): Promise<string> {
  runtime ??= bundle('./runtime/main.ts').then((built) => built.script, (error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

/** The standalone player, which mounts the stage runtime from the page's `#stage-runtime` element. */
export function buildOfflinePlayer(): Promise<string> {
  player ??= bundle('./offline/main.ts').then((built) => built.script, (error: unknown) => {
    player = null;
    throw error;
  });
  return player;
}

let driver: Promise<string> | null = null;

function buildToolsDriver(): Promise<string> {
  driver ??= bundle('./tools/main.ts').then((built) => built.script, (error: unknown) => {
    driver = null;
    throw error;
  });
  return driver;
}

/** Film code reaches nothing outside the page, and the page nothing outside itself. */
export const TOOLS_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/**
 * The tools page: one self-contained HTML file, the stage runtime and its driver inside it, that shows no UI and
 * sets `window.filmTools` (see `./tools`) for a headless browser to load a film into and take stills from.
 */
export async function buildToolsPage(): Promise<string> {
  const [runtime, tools] = await Promise.all([buildStageRuntime(), buildToolsDriver()]);
  return (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${TOOLS_CONTENT_SECURITY_POLICY}">` +
    '<title>Film tools</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#111}</style></head><body>' +
    `<script type="text/plain" id="${OFFLINE_RUNTIME_ID}">${inScript(runtime)}</script>` +
    `<script>${inScript(tools)}</script></body></html>`
  );
}
