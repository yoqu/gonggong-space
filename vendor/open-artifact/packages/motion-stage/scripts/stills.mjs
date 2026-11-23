#!/usr/bin/env node
// Stills of a video artifact from a checkout, drawn as its export draws them (see src/stills.ts). Installed, the same
// is `open-artifact stills <root> --at <t1,t2,…>`.
//
//   node packages/motion-stage/scripts/stills.mjs <artifact-folder> <t1,t2,…> [--out <dir>] [--scale <n>] [--rough]

import { buildToolsPage } from '../src/build.ts';
import { StillsError, drawStills, parseStillScale, parseStillTimes } from '../src/stills.ts';

const USAGE = 'Usage: node stills.mjs <artifact-folder> <t1,t2,…> [--out <dir>] [--scale <n>] [--rough]';

const stop = (message) => {
  console.error(message);
  process.exit(1);
};

function parseArgs(argv) {
  const options = { root: null, times: null, out: null, scale: undefined, mode: 'final' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') options.out = argv[++i] ?? null;
    else if (arg === '--scale') options.scale = argv[++i];
    else if (arg === '--rough') options.mode = 'rough';
    else if (options.root === null) options.root = arg;
    else if (options.times === null) options.times = arg;
    else stop('Unexpected argument: ' + arg);
  }
  if (options.root === null || options.times === null) stop(USAGE);
  const times = parseStillTimes(options.times) ?? stop('Times are played seconds, comma-separated: 0.8,2.4,5');
  const scale = parseStillScale(options.scale) ?? stop('--scale is above 0 and at most 4');
  return { ...options, times, scale };
}

try {
  process.exitCode = await drawStills(parseArgs(process.argv.slice(2)), await buildToolsPage());
} catch (error) {
  if (!(error instanceof StillsError)) throw error;
  stop(error.message);
}
