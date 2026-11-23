/**
 * Which paths of an artifact folder travel: the ones an export zip holds, a Link sync pushes and pulls, and a host's
 * `link.manifest` lists. This mirrors `archiveKeeps` in the type server's `archive.ts` (the daemon cannot import the
 * type server), and a test of the daemon checks the two agree.
 *
 * Left out: the agent channel (`_agent/` at the top), dot files but the few that carry portable data, `node_modules`,
 * `.git`, the OS's `.DS_Store` / `Thumbs.db` / `desktop.ini`, and the temp files of atomic writes.
 */

/** Hidden paths carrying portable artifact data, relative to the artifact folder. */
const KEPT_DOT_FILES = new Set(['.artifact.json', '.gitignore', 'doc/.sessions.json', 'doc/.people.json', 'doc/tabs/.deleted']);
/** Never carried, at any depth. */
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.git', 'node_modules']);
/** Never carried, at the folder's top. */
const LOCAL_DIRS = new Set(['_agent']);
/** An atomic write's temp file. */
const isTemp = (name: string): boolean => name.endsWith('.tmp') || name.startsWith('.tmp-');

/**
 * Whether a path under an artifact folder (forward slashes, no leading slash) is one an export zip carries, by name
 * alone.
 */
export function archiveIncludes(path: string): boolean {
  if (!path) return false;
  let parent = '';
  for (const name of path.split('/')) {
    if (!name || name === '.' || name === '..') return false;
    const inner = parent ? `${parent}/${name}` : name;
    if (JUNK.has(name) || isTemp(name)) return false;
    if (name.startsWith('.') && !KEPT_DOT_FILES.has(inner)) return false;
    if (parent === '' && LOCAL_DIRS.has(name)) return false;
    parent = inner;
  }
  return true;
}

/**
 * Whether a path is written only by the server that holds the artifact (Docs' `doc/`, Sheets' `sheet/`): a Link sync
 * never pushes it and keeps the working copy's version as a read-only mirror of the host's.
 */
export function serverWrittenPath(path: string): boolean {
  return path === 'doc' || path === 'sheet' || path.startsWith('doc/') || path.startsWith('sheet/');
}
