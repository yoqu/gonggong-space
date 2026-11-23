/** Builds the Motion editor into the type server's asset folder. */

import tailwindcss from '@tailwindcss/vite';
import { motionExportScripts } from '@open-artifact/motion-export/vite';
import { motionStageRuntime } from '@open-artifact/motion-stage/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Served under /motion/<token>/, so every URL must be relative.
  base: './',
  plugins: [tailwindcss(), motionStageRuntime(), motionExportScripts()],
  build: {
    outDir: fileURLToPath(new URL('../../dist/server/editors/motion', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // One self-contained editor page; splitting buys nothing on localhost.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      onwarn(warning, warn) {
        // Base UI marks its modules "use client"; meaningless in a client bundle.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
});
