/**
 * Whole-project checks of a Design System artifact. Paths are relative to
 * `project/`. Binary files are passed with an empty string as content; only
 * their paths matter here.
 */

import { normalizeTokens } from './tokens.ts';
import {
  COMPONENT_NAME,
  MAX_SECTIONS,
  fileRole,
  hasMarker,
  isAssetGroupName,
  listSections,
  normalizeSystemIndex,
  parseBundleHeader,
  parseCardMarker,
  pathProblem,
} from './system.ts';

/** A finding tied to a file. */
export interface SystemDiagnostic {
  file: string;
  level: 'error' | 'warning' | 'info';
  message: string;
}

/** Size caps of text files, bytes. */
const CAPS: Record<string, number> = {
  readme: 200 * 1024,
  tokens: 512 * 1024,
  bundle: 6 * 1024 * 1024,
  'bundle-css': 2 * 1024 * 1024,
  library: 2 * 1024 * 1024,
  'component-preview': 256 * 1024,
  'component-readme': 64 * 1024,
  'component-source': 512 * 1024,
};

/** Embeds a preview may not use. */
const PREVIEW_EMBEDS = /<(iframe|frame|object|embed|portal|noscript)\b/i;

/** Checks a design system's files. */
export function checkDesignSystem(files: ReadonlyMap<string, string>, blobExists?: (id: string) => boolean): SystemDiagnostic[] {
  const out: SystemDiagnostic[] = [];
  const add = (file: string, level: SystemDiagnostic['level'], message: string): void => {
    out.push({ file, level, message });
  };

  // The index.
  const indexText = files.get('design-system.json');
  let namespace = '';
  const restored = new Set<string>();
  if (indexText === undefined) {
    add('design-system.json', 'error', 'project/design-system.json is missing: the page treats the system as empty.');
  } else {
    try {
      const raw = JSON.parse(indexText) as unknown;
      if (!hasMarker(raw)) add('design-system.json', 'error', 'The index has no createdOnFiles or convertedFrom marker; the page opens read-only.');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an index object.');
      const fields = raw as Record<string, unknown>;
      if (typeof fields.v !== 'number' || fields.v < 3 || fields.layout !== 'files') {
        add('design-system.json', 'error', 'Expected version 3 or later with layout "files".');
      }
      const index = normalizeSystemIndex(raw);
      namespace = index.namespace;
      if (!COMPONENT_NAME.test(index.namespace)) add('design-system.json', 'error', `namespace "${index.namespace}" must be a JS identifier of at most 64 characters.`);
      const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
      const issue = (message: string): void => add('design-system.json', 'error', message);
      if (object(fields.content)) issue('Unpack the content envelope into project files before editing.');
      if (fields.title !== undefined && typeof fields.title !== 'string') issue('title must be text.');
      if (fields.namespace !== undefined && (typeof fields.namespace !== 'string' || !fields.namespace)) issue('namespace must be a JavaScript identifier.');
      if (fields.sections !== undefined && (!object(fields.sections) || Object.values(fields.sections).some((title) => typeof title !== 'string'))) issue('sections must map section names to titles.');
      const docs = fields.docs;
      if (docs !== undefined && (!object(docs) || (docs.readme !== undefined && typeof docs.readme !== 'string') ||
        (docs.sections !== undefined && (!Array.isArray(docs.sections) || docs.sections.some((path) => typeof path !== 'string'))))) issue('docs needs an optional readme path and a list of section paths.');
      if (fields.libraries !== undefined && !Array.isArray(fields.libraries)) issue('libraries must be a list.');
      for (const [i, lib] of (Array.isArray(fields.libraries) ? fields.libraries : []).entries()) {
        if (!object(lib) || typeof lib.name !== 'string' || typeof lib.version !== 'string') issue(`libraries[${i}] needs a name and version.`);
        else if (lib.file !== undefined) {
          if (typeof lib.file !== 'string' || !lib.file.startsWith('components/lib/') || !files.has(lib.file)) issue(`libraries[${i}] must point to an existing file under components/lib/.`);
          if (lib.global !== undefined && (typeof lib.global !== 'string' || !COMPONENT_NAME.test(lib.global))) issue(`libraries[${i}].global must be a JavaScript identifier.`);
        } else if (lib.name !== 'react' && lib.name !== 'react-dom') issue(`libraries[${i}] needs a local file for ${lib.name}.`);
      }
      const records = (value: unknown, location: string, prefix = ''): void => {
        if (value === undefined) return;
        if (!object(value)) {
          add('design-system.json', 'error', `${location} must be an object of upload records.`);
          return;
        }
        for (const [key, record] of Object.entries(value)) {
          if (!object(record) || typeof record.name !== 'string' || !record.name || pathProblem(prefix + record.name) ||
              !Number.isSafeInteger(record.size) || Number(record.size) < 0 || typeof record.type !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;.*)?$/.test(record.type)) {
            add('design-system.json', 'error', `${location}.${key} needs name, blob, size and type.`);
          } else if (!files.has(prefix + record.name) && (typeof record.blob !== 'string' || !/^[a-f0-9]{32}$/.test(record.blob))) {
            issue(`${location}.${key} needs a 32-character hex upload id.`);
          } else if (!files.has(prefix + record.name) && blobExists && !blobExists(String(record.blob))) {
            issue(`Missing upload for ${prefix}${record.name}: ${record.blob}.`);
          } else restored.add(prefix + record.name);
        }
      };
      records(fields.blobs, 'blobs');
      if (fields.groups !== undefined && (!Array.isArray(fields.groups) || fields.groups.some((key) => typeof key !== 'string'))) {
        add('design-system.json', 'error', 'groups must be a list of asset group keys.');
      }
      if (fields.assetGroups !== undefined && !object(fields.assetGroups)) add('design-system.json', 'error', 'assetGroups must be an object.');
      for (const [key, group] of Object.entries(object(fields.assetGroups) ? fields.assetGroups : {})) {
        if (!object(group)) {
          add('design-system.json', 'error', `assetGroups.${key} must be an object.`);
          continue;
        }
        const name = index.assetGroups[key]!.name;
        if (!isAssetGroupName(group.name ?? name)) issue(`assetGroups.${key} needs a valid group folder name.`);
        if (group.tile !== undefined && !['xs', 's', 'm', 'l', 'xl'].includes(String(group.tile))) add('design-system.json', 'error', `Invalid tile size in ${name}.`);
        if (group.order !== undefined && (!Array.isArray(group.order) || group.order.some((item) => typeof item !== 'string'))) add('design-system.json', 'error', `Expected a list of file names in ${name}.order.`);
        records(group.files, `assetGroups.${key}.files`, `assets/${name}/`);
      }
      if (index.lastChange && (typeof index.lastChange.by !== 'string' || typeof index.lastChange.at !== 'string')) {
        add('design-system.json', 'warning', 'lastChange needs "by" and "at".');
      }
    } catch (error) {
      add('design-system.json', 'error', `design-system.json is not valid JSON: ${String(error)}`);
    }
  }

  // Tokens.
  const tokensText = files.get('tokens.json');
  if (tokensText === undefined) {
    add('tokens.json', 'warning', 'No tokens.json: Colors, Typography and Spacing show empty.');
  } else {
    try {
      const raw: unknown = JSON.parse(tokensText);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) add('tokens.json', 'error', 'Expected an object of token families.');
      const { tokens, notes } = normalizeTokens(raw);
      for (const note of notes) add('tokens.json', note.level === 'warning' ? 'error' : note.level, note.message);
      for (const font of tokens.fonts) {
        if (!files.has(font.file) && !restored.has(font.file)) add('tokens.json', 'error', `Font file ${font.file} is missing.`);
      }
    } catch (error) {
      add('tokens.json', 'error', `tokens.json is not valid JSON: ${String(error)}`);
    }
  }

  // Bundle.
  const bundle = files.get('components/bundle.js');
  if (bundle !== undefined) {
    if (/<\/script/i.test(bundle) || /<!--/.test(bundle)) add('components/bundle.js', 'warning', 'bundle.js contains "</script" or "<!--"; consumers that inline it will break.');
    if (/^\s*(import|export)\s/m.test(bundle)) add('components/bundle.js', 'error', 'bundle.js must be one classic script: no import or export.');
    const header = parseBundleHeader(bundle);
    if (header?.namespace && namespace && header.namespace !== namespace) {
      add('components/bundle.js', 'warning', `Bundle header namespace "${header.namespace}" differs from the index namespace "${namespace}".`);
    }
  }

  // Every file.
  for (const [path, content] of files) {
    const problem = pathProblem(path);
    if (problem) add(path, 'error', `Path ${problem}.`);
    const role = fileRole(path);
    const cap = CAPS[role];
    if (cap !== undefined && new TextEncoder().encode(content).length > cap) add(path, 'error', `Larger than ${Math.round(cap / 1024)} KB.`);
    if (role === 'component-preview') {
      if (!parseCardMarker(content)) add(path, 'warning', 'Line 1 should be the <!-- @dsCard group="…" height=N --> marker.');
      if (PREVIEW_EMBEDS.test(content)) add(path, 'error', 'Previews may not use iframe, frame, object, embed, portal or noscript.');
      for (const match of content.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
        const url = match[1]!;
        if (/fonts\.(googleapis|gstatic)\.com/.test(url)) continue;
        if (!/@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//.test(url)) add(path, 'warning', `Pin ${url.slice(0, 80)} to an exact version.`);
      }
    }
    if (path.startsWith('components/') && role === 'other') {
      const folder = path.split('/')[1]!;
      if (!COMPONENT_NAME.test(folder) && folder !== 'lib' && folder !== 'src') add(path, 'warning', `components/${folder} is not a JS identifier; it is not a component.`);
    }
    if (role === 'font' && !/\.(woff2?|ttf|otf|ttc)$/i.test(path)) add(path, 'warning', 'fonts/ holds font binaries only.');
  }

  const { overflow } = listSections(files);
  if (overflow.length) add(overflow[0]!, 'info', `More than ${MAX_SECTIONS} sections; ${overflow.length} stay files.`);
  if (!files.has('components/Cover/preview.html')) add('components/Cover/preview.html', 'info', 'No cover: Overview opens with the brand book.');
  return out;
}
