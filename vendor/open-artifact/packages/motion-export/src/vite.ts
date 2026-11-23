import type { Plugin } from 'vite';
import { RASTER_FRAME_ENTRY, STANDALONE_AUDIO_ENTRY, buildExportScriptFresh } from './build.ts';

export const RASTER_FRAME_MODULE = 'virtual:motion-raster-frame';
export const STANDALONE_AUDIO_MODULE = 'virtual:motion-standalone-audio';

const ENTRIES: ReadonlyMap<string, typeof RASTER_FRAME_ENTRY | typeof STANDALONE_AUDIO_ENTRY> = new Map([
  ['\0' + RASTER_FRAME_MODULE, RASTER_FRAME_ENTRY],
  ['\0' + STANDALONE_AUDIO_MODULE, STANDALONE_AUDIO_ENTRY],
]);

/**
 * Gives the page the export's scripts as strings: `import rasterFrame from 'virtual:motion-raster-frame'` and
 * `import standaloneAudio from 'virtual:motion-standalone-audio'`.
 */
export function motionExportScripts(): Plugin {
  const watched = new Map<string, Set<string>>();
  return {
    name: 'motion-export-scripts',
    resolveId(id) {
      return ENTRIES.has('\0' + id) ? '\0' + id : null;
    },
    async load(id) {
      const entry = ENTRIES.get(id);
      if (entry === undefined) return null;
      const built = await buildExportScriptFresh(entry);
      watched.set(id, new Set(built.inputs));
      for (const input of built.inputs) this.addWatchFile(input);
      return 'export default ' + JSON.stringify(built.script) + ';\n';
    },
    // A script's source is not in the page's module graph: its change makes the virtual module stale by hand.
    handleHotUpdate({ file, server }) {
      const stale = [...watched]
        .filter(([, inputs]) => inputs.has(file))
        .flatMap(([id]) => {
          const module = server.moduleGraph.getModuleById(id);
          if (!module) return [];
          server.moduleGraph.invalidateModule(module);
          return [module];
        });
      return stale.length > 0 ? stale : undefined;
    },
  };
}
