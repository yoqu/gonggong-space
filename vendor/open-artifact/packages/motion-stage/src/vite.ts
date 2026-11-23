import type { Plugin } from 'vite';
import { buildOfflinePlayer, buildStageRuntimeFresh } from './build.ts';

export const STAGE_RUNTIME_MODULE = 'virtual:motion-stage-runtime';
export const STAGE_PLAYER_MODULE = 'virtual:motion-stage-player';
const RESOLVED = '\0' + STAGE_RUNTIME_MODULE;
const RESOLVED_PLAYER = '\0' + STAGE_PLAYER_MODULE;

/**
 * Gives the page the stage runtime as a string, `import runtime from 'virtual:motion-stage-runtime'`, and the
 * standalone player a saved page runs, `import player from 'virtual:motion-stage-player'`.
 */
export function motionStageRuntime(): Plugin {
  let watched = new Set<string>();
  return {
    name: 'motion-stage-runtime',
    resolveId(id) {
      if (id === STAGE_RUNTIME_MODULE) return RESOLVED;
      if (id === STAGE_PLAYER_MODULE) return RESOLVED_PLAYER;
      return null;
    },
    async load(id) {
      if (id === RESOLVED_PLAYER) return 'export default ' + JSON.stringify(await buildOfflinePlayer()) + ';\n';
      if (id !== RESOLVED) return null;
      const built = await buildStageRuntimeFresh();
      watched = new Set(built.inputs);
      for (const input of built.inputs) this.addWatchFile(input);
      return 'export default ' + JSON.stringify(built.script) + ';\n';
    },
    // A runtime source is not in the page's module graph: its change makes the virtual module stale by hand.
    handleHotUpdate({ file, server }) {
      if (!watched.has(file)) return;
      const module = server.moduleGraph.getModuleById(RESOLVED);
      if (!module) return;
      server.moduleGraph.invalidateModule(module);
      return [module];
    },
  };
}
