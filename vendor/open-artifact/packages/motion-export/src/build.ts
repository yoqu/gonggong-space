import { fileURLToPath } from 'node:url';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';

export interface BuiltScript {
  script: string;
  /** Absolute paths of the source files that went into it, for a dev server to watch. */
  inputs: string[];
}

const here = fileURLToPath(new URL('.', import.meta.url));
const entryExtension = extname(fileURLToPath(import.meta.url));

/** Both scripts run as classic scripts: the raster frame from a srcdoc, the audio in a page saved to disk. */
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
    // Classic scripts have no import.meta; motion-core resolves its font files against it at load.
    define: { 'import.meta.url': '"file:///"' },
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('esbuild gave no output for ' + entry);
  const inputs = Object.keys(result.metafile.inputs).map((input) => resolve(here, input));
  return { script: output.text, inputs };
}

export const RASTER_FRAME_ENTRY = './raster/frame-entry.ts';
export const STANDALONE_AUDIO_ENTRY = './standalone/audio-entry.ts';

/** A script built afresh, with its inputs: for a dev server, which builds it again when one changes. */
export const buildExportScriptFresh = (entry: typeof RASTER_FRAME_ENTRY | typeof STANDALONE_AUDIO_ENTRY): Promise<BuiltScript> => bundle(entry);

function once(entry: string): () => Promise<string> {
  let built: Promise<string> | null = null;
  return () => {
    built ??= bundle(entry).then(
      (result) => result.script,
      (error: unknown) => {
        built = null;
        throw error;
      },
    );
    return built;
  };
}

/** The raster frame's script, which turns a snapshot's SVG into a bitmap: built once per process. */
export const buildRasterFrame: () => Promise<string> = once(RASTER_FRAME_ENTRY);

/** The standalone page's audio, which sets `window.filmAudio`: built once per process. */
export const buildStandaloneAudio: () => Promise<string> = once(STANDALONE_AUDIO_ENTRY);
