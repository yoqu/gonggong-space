/**
 * A Design System artifact kept in files: the index
 * (`project/design-system.json`), what each file under `project/` is, the
 * component catalogue, the brand-book sections and the generated
 * `manifest.json`. Paths here are relative to `project/`.
 */

/* -------------------------------------------------------------------------- */
/* The index                                                                   */
/* -------------------------------------------------------------------------- */

/** Current index version. */
export const SYSTEM_VERSION = 3;

/** A script library previews load before the bundle. */
export interface Library {
  name: string;
  version: string;
  /** Global the script defines (`React`). */
  global?: string;
  /** File under `project/` (`components/lib/react.js`); absent = loaded from a pinned CDN. */
  file?: string;
}

/** Tile sizes of an asset group. */
export type TileSize = 'xl' | 'l' | 'm' | 's' | 'xs';

/** An uploaded asset named by the index. */
export interface AssetRecord {
  /** Path below the group folder. */
  name: string;
  /** Blob id (served at `/_blob/<id>`). */
  blob: string;
  size: number;
  type: string;
}

/** An asset group (`assets/<Group>/`). */
export interface AssetGroup {
  name: string;
  tile?: TileSize;
  /** File names in tile order. */
  order: string[];
  /** Uploads by key (the name with unsafe bytes written `~xx`). */
  files: Record<string, AssetRecord>;
  [key: string]: unknown;
}

/** The last change, shown on the page. */
export interface LastChange {
  by: string;
  at: string;
  via?: string;
  note?: string;
  [key: string]: unknown;
}

/** `project/design-system.json`. */
export interface SystemIndex {
  v: number;
  layout: 'files';
  createdOnFiles?: { v: number; at: string };
  convertedFrom?: Record<string, unknown>;
  title: string;
  /** The bundle's global (`window.<namespace>`). */
  namespace: string;
  libraries: Library[];
  /** Card titles a reader set. */
  sections: Record<string, string>;
  /** Asset group order. */
  groups: string[];
  assetGroups: Record<string, AssetGroup>;
  blobs: Record<string, unknown>;
  docs: { readme?: string; sections: unknown[] };
  lastChange?: LastChange;
  /** `"off"`: read-only page offering a clean-up; `"code"`: synced from code. */
  editing?: 'off' | 'code';
  [key: string]: unknown;
}

/** A new, empty index. */
export function emptySystemIndex(title: string, now = new Date()): SystemIndex {
  return {
    v: SYSTEM_VERSION,
    layout: 'files',
    createdOnFiles: { v: 1, at: now.toISOString().replace(/\.\d{3}Z$/, 'Z') },
    title,
    namespace: toNamespace(title),
    libraries: [],
    sections: {},
    groups: [],
    assetGroups: {},
    blobs: {},
    docs: { readme: 'project/README.md', sections: [] },
  };
}

/** A JS identifier from a title (`"Acme UI"` → `AcmeUI`). */
export function toNamespace(title: string): string {
  const id = title.replace(/[^A-Za-z0-9_$]+/g, '').slice(0, 64);
  return COMPONENT_NAME.test(id) ? id : `DS${id}`.slice(0, 64);
}

/** True when the parsed index carries the marker (`createdOnFiles` or `convertedFrom`). */
export function hasMarker(index: unknown): boolean {
  const raw = index as Record<string, unknown> | null;
  return !!raw && [raw.createdOnFiles, raw.convertedFrom].some((marker) => marker !== null && typeof marker === 'object' && !Array.isArray(marker));
}

/** Normalizes a parsed index, keeping unknown keys. */
export function normalizeSystemIndex(input: unknown): SystemIndex {
  const raw = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const assetGroups: Record<string, AssetGroup> = Object.create(null);
  if (raw.assetGroups && typeof raw.assetGroups === 'object') {
    for (const [key, group] of Object.entries(raw.assetGroups as Record<string, Partial<AssetGroup>>)) {
      if (!group || typeof group !== 'object') continue;
      assetGroups[key] = {
        ...group,
        name: typeof group.name === 'string' ? group.name : decodeAssetKey(key),
        order: Array.isArray(group.order) ? group.order.filter((name): name is string => typeof name === 'string') : [],
        files: group.files && typeof group.files === 'object' ? group.files : {},
      };
    }
  }
  const title = typeof raw.title === 'string' ? raw.title : 'Design system';
  return {
    ...raw,
    v: typeof raw.v === 'number' ? raw.v : SYSTEM_VERSION,
    layout: 'files',
    title,
    namespace: typeof raw.namespace === 'string' && raw.namespace ? raw.namespace : toNamespace(title),
    libraries: Array.isArray(raw.libraries) ? (raw.libraries as Library[]).filter((lib) => lib && typeof lib.name === 'string') : [],
    sections: raw.sections && typeof raw.sections === 'object' ? (raw.sections as Record<string, string>) : {},
    groups: Array.isArray(raw.groups) ? raw.groups.filter((g): g is string => typeof g === 'string') : [],
    assetGroups,
    blobs: raw.blobs && typeof raw.blobs === 'object' ? (raw.blobs as Record<string, unknown>) : {},
    docs: raw.docs && typeof raw.docs === 'object' ? (raw.docs as SystemIndex['docs']) : { sections: [] },
  };
}

/** Display names that can form one asset folder and one index entry. */
export function isAssetGroupName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 80 && name.trim() === name &&
    !/[/\\\u0000-\u001f\u007f]/.test(name) && !name.startsWith('.') && !Object.hasOwn(Object.prototype, name) && name !== 'prototype';
}

/** The record key of an asset name: bytes outside `[A-Za-z0-9_./-]` written `~` + two hex digits. */
export function assetKey(name: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(name)) {
    const ch = String.fromCharCode(byte);
    out += /[A-Za-z0-9_./-]/.test(ch) ? ch : `~${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** Display name for an encoded index key in a system without an explicit name. */
export function decodeAssetKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/%/g, '%25').replace(/~([0-9a-f]{2})/gi, '%$1'));
  } catch {
    return key;
  }
}

/** Also recognizes older Open Artifact indexes that used literal group keys. */
export function assetGroupKey(groups: Record<string, AssetGroup>, name: string): string {
  return Object.keys(groups).find((key) => (groups[key]?.name ?? decodeAssetKey(key)) === name) ?? assetKey(name);
}

/* -------------------------------------------------------------------------- */
/* Files                                                                       */
/* -------------------------------------------------------------------------- */

/** What a project file is. */
export type FileRole =
  | 'index'
  | 'tokens'
  | 'tokens-css'
  | 'manifest'
  | 'readme'
  | 'section'
  | 'bundle'
  | 'bundle-css'
  | 'types'
  | 'library'
  | 'component-preview'
  | 'component-readme'
  | 'component-types'
  | 'component-source'
  | 'font'
  | 'asset'
  | 'archived'
  | 'api-card'
  | 'other';

/** Component folder names must be ASCII JS identifiers. */
export const COMPONENT_NAME = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
/** Most brand-book sections besides the README. */
export const MAX_SECTIONS = 24;

/** Path rules: relative, `/`-separated, no `..`, no dot-files, no toolchain manifests. */
export function pathProblem(path: string): string | null {
  if (!path || path.startsWith('/') || path.includes('\\')) return 'must be a relative path with / separators';
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return 'has an empty, . or .. segment';
  if (parts.some((part) => part.startsWith('.') && part !== '.image-slots.state.json')) return 'has a dot-prefixed segment';
  if (parts.includes('node_modules')) return 'is inside node_modules';
  const base = parts[parts.length - 1]!.toLowerCase();
  if (['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bunfig.toml', 'tsconfig.json', 'deno.json', 'agents.md'].includes(base)) {
    return 'is a toolchain or agent manifest';
  }
  if (/~\d/.test(parts[parts.length - 1]!)) return 'looks like an 8.3 short name';
  if (['index.html', 'skill.md'].includes(path.toLowerCase()) || path.startsWith('artifact-type/')) return 'is reserved by the type';
  return null;
}

/** Classifies a project file. */
export function fileRole(path: string): FileRole {
  if (path === 'design-system.json') return 'index';
  if (path === 'tokens.json') return 'tokens';
  if (path === 'tokens.css') return 'tokens-css';
  if (path === 'manifest.json') return 'manifest';
  if (path.toLowerCase() === 'readme.md') return 'readme';
  if (path.startsWith('archived/')) return 'archived';
  if (path.startsWith('api/')) return 'api-card';
  if (path.startsWith('fonts/')) return 'font';
  if (path.startsWith('assets/')) return 'asset';
  if (path === 'components/bundle.js') return 'bundle';
  if (path === 'components/bundle.css') return 'bundle-css';
  if (path === 'components/index.d.ts') return 'types';
  if (path.startsWith('components/lib/') && path.endsWith('.js')) return 'library';
  if (path.startsWith('components/src/')) return 'component-source';
  const component = /^components\/([^/]+)\/(preview\.html|README\.md|[^/]+\.d\.ts)$/.exec(path);
  if (component && COMPONENT_NAME.test(component[1]!)) {
    if (component[2] === 'preview.html') return 'component-preview';
    if (component[2] === 'README.md') return 'component-readme';
    return 'component-types';
  }
  if (/\.mdx?$/i.test(path) && !path.startsWith('components/')) return 'section';
  return 'other';
}

/* -------------------------------------------------------------------------- */
/* Components                                                                  */
/* -------------------------------------------------------------------------- */

/** The `<!-- @dsCard … -->` marker on line 1 of a preview. */
export interface CardMarker {
  group?: string;
  /** Row height, 40–4000 (else 120). */
  height: number;
  /** Layout width; the preview is scaled down to fit. */
  width?: number;
  subtitle?: string;
  /** Generated no-example card: static, no mount. */
  floor?: boolean;
  /** A showcase page, not a bundle export. */
  page?: boolean;
}

/** Parses line 1 of a preview. Returns `null` when there is no marker. */
export function parseCardMarker(html: string): CardMarker | null {
  const line = html.split('\n', 1)[0] ?? '';
  const match = /^\s*<!--\s*@dsCard\b([\s\S]*?)-->/.exec(line);
  if (!match) return null;
  const attrs: Record<string, string | true> = {};
  for (const attr of match[1]!.matchAll(/([A-Za-z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) {
    attrs[attr[1]!] = attr[2] ?? attr[3] ?? attr[4] ?? true;
  }
  const height = Number(attrs.height);
  const width = Number(attrs.width);
  const marker: CardMarker = { height: Number.isFinite(height) && height >= 40 && height <= 4000 ? height : 120 };
  if (typeof attrs.group === 'string') marker.group = attrs.group;
  if (typeof attrs.subtitle === 'string') marker.subtitle = attrs.subtitle;
  if (Number.isFinite(width) && width > 0) marker.width = width;
  if (attrs.floor) marker.floor = true;
  if (attrs.page) marker.page = true;
  return marker;
}

/** Writes a marker line. */
export function formatCardMarker(marker: CardMarker): string {
  const parts = ['<!-- @dsCard'];
  if (marker.group) parts.push(`group="${marker.group.replace(/"/g, '')}"`);
  parts.push(`height=${marker.height}`);
  if (marker.width) parts.push(`width=${marker.width}`);
  if (marker.subtitle) parts.push(`subtitle="${marker.subtitle.replace(/"/g, '')}"`);
  if (marker.floor) parts.push('floor');
  if (marker.page) parts.push('page');
  parts.push('-->');
  return parts.join(' ');
}

/** The `/* @ds-bundle: {…} *\/` header on line 1 of bundle.js. */
export interface BundleHeader {
  format?: number;
  namespace?: string;
  components: { name: string }[];
}

/** Parses the bundle header; `null` when absent or malformed. */
export function parseBundleHeader(bundle: string): BundleHeader | null {
  const match = /^\s*\/\*\s*@ds-bundle:\s*(\{[\s\S]*?\})\s*\*\//.exec(bundle.split('\n', 1)[0] ?? '');
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]!) as Partial<BundleHeader>;
    return {
      format: value.format,
      namespace: value.namespace,
      components: Array.isArray(value.components) ? value.components.filter((c) => c && typeof c.name === 'string') : [],
    };
  } catch {
    return null;
  }
}

/** One component in the catalogue. */
export interface ComponentInfo {
  name: string;
  group?: string;
  /** First sentence of its README. */
  summary?: string;
  page?: boolean;
  hasPreview: boolean;
  hasReadme: boolean;
  marker: CardMarker | null;
}

/** First sentence of a markdown text (skipping a leading heading). */
export function firstSentence(markdown: string): string | undefined {
  const body = markdown
    .replace(/^\s*#[^\n]*\n/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_`>#]/g, '')
    .trim();
  const match = /^([\s\S]*?[.!?])(\s|$)/.exec(body);
  const sentence = (match ? match[1]! : body.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
  return sentence ? sentence.slice(0, 280) : undefined;
}

/**
 * Builds the component catalogue: the bundle header's names first (in its
 * order), then every `components/<Comp>/` folder with a preview or README.
 */
export function listComponents(files: ReadonlyMap<string, string>): ComponentInfo[] {
  const names: string[] = [];
  const header = parseBundleHeader(files.get('components/bundle.js') ?? '');
  for (const component of header?.components ?? []) if (COMPONENT_NAME.test(component.name) && !names.includes(component.name)) names.push(component.name);
  const folders = new Set<string>();
  for (const path of files.keys()) {
    const role = fileRole(path);
    if (role === 'component-preview' || role === 'component-readme') folders.add(path.split('/')[1]!);
  }
  for (const name of [...folders].sort((a, b) => a.localeCompare(b))) if (!names.includes(name)) names.push(name);
  return names.map((name) => {
    const preview = files.get(`components/${name}/preview.html`);
    const readme = files.get(`components/${name}/README.md`);
    const marker = preview ? parseCardMarker(preview) : null;
    const info: ComponentInfo = { name, hasPreview: preview !== undefined, hasReadme: readme !== undefined, marker };
    if (marker?.group) info.group = marker.group;
    if (marker?.page) info.page = true;
    const summary = readme ? firstSentence(readme) : undefined;
    if (summary) info.summary = summary;
    return info;
  });
}

/* -------------------------------------------------------------------------- */
/* Brand book                                                                  */
/* -------------------------------------------------------------------------- */

/** A brand-book section. */
export interface DocSection {
  path: string;
  title: string;
}

/** Title of a markdown file: its first `#` heading, else its name. */
export function markdownTitle(path: string, text: string): string {
  const heading = /^\s*#\s+(.+)$/m.exec(text);
  if (heading) return heading[1]!.trim();
  const base = path.split('/').pop()!.replace(/\.mdx?$/i, '');
  return base.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** The README plus up to {@link MAX_SECTIONS} further sections, in path order. */
export function listSections(files: ReadonlyMap<string, string>): { readme: DocSection | null; sections: DocSection[]; overflow: string[] } {
  const readmePath = [...files.keys()].find((path) => path.toLowerCase() === 'readme.md') ?? null;
  const all = [...files.keys()]
    .filter((path) => fileRole(path) === 'section')
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, title: markdownTitle(path, files.get(path) ?? '') }));
  return {
    readme: readmePath ? { path: readmePath, title: markdownTitle(readmePath, files.get(readmePath) ?? '') } : null,
    sections: all.slice(0, MAX_SECTIONS),
    overflow: all.slice(MAX_SECTIONS).map((section) => section.path),
  };
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

/** An asset as the Assets view lists it. */
export interface AssetItem {
  group: string;
  /** Path below the group folder. */
  name: string;
  /** Project path when kept as a file. */
  path?: string;
  /** Blob id when it is an upload. */
  blob?: string;
  type?: string;
  size?: number;
}

/** The group of an asset path: the first folder under `assets/` ("Other" when directly inside). */
export function assetGroupOf(path: string): { group: string; name: string } {
  const rest = path.slice('assets/'.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? { group: 'Other', name: rest } : { group: rest.slice(0, slash), name: rest.slice(slash + 1) };
}

/** Uploads restored to their logical paths when an exported system has no physical copy. */
export function indexedUploads(index: SystemIndex): Map<string, AssetRecord> {
  const uploads = new Map<string, AssetRecord>();
  const collect = (entries: Record<string, unknown>, prefix: string) => {
    for (const value of Object.values(entries)) {
      const record = value as AssetRecord | null;
      if (!record || typeof record.name !== 'string' || !/^[0-9a-f]{32}$/.test(record.blob)) continue;
      const path = prefix + record.name;
      if (!pathProblem(path) && (path.startsWith('assets/') || path.startsWith('fonts/'))) uploads.set(path, record);
    }
  };
  collect(index.blobs, '');
  for (const group of Object.values(index.assetGroups)) collect(group.files, `assets/${group.name}/`);
  return uploads;
}

/** Lists asset groups and their items: index records first (in `order`), then files. */
export function listAssets(index: SystemIndex, paths: Iterable<string>): { name: string; tile: TileSize; items: AssetItem[] }[] {
  const groups = new Map<string, AssetItem[]>();
  const add = (item: AssetItem): void => {
    const list = groups.get(item.group) ?? [];
    if (!list.some((existing) => existing.name === item.name)) list.push(item);
    groups.set(item.group, list);
  };
  // A folder exported with both a file and its old upload record uses the file.
  for (const path of paths) {
    if (!path.startsWith('assets/')) continue;
    const { group, name } = assetGroupOf(path);
    if (name.toLowerCase() === 'readme.md') groups.set(group, groups.get(group) ?? []);
    else add({ group, name, path });
  }
  const keys = [...new Set([...index.groups, ...Object.keys(index.assetGroups)])];
  const orderedNames = new Set<string>();
  for (const key of keys) {
    const group = index.assetGroups[key];
    const name = group?.name ?? decodeAssetKey(key);
    orderedNames.add(name);
    groups.set(name, groups.get(name) ?? []);
    for (const record of Object.values(group?.files ?? {})) {
      if (typeof record?.name === 'string' && typeof record.blob === 'string') {
        add({ group: name, name: record.name, blob: record.blob, type: record.type, size: record.size });
      }
    }
  }
  const order = [...orderedNames, ...[...groups.keys()].filter((name) => !orderedNames.has(name)).sort()];
  return order.map((name) => {
    const items = groups.get(name)!;
    const metadata = index.assetGroups[assetGroupKey(index.assetGroups, name)];
    const tileOrder = metadata?.order ?? [];
    items.sort((a, b) => {
      const ia = tileOrder.indexOf(a.name);
      const ib = tileOrder.indexOf(b.name);
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || a.name.localeCompare(b.name);
    });
    return { name, tile: metadata?.tile ?? 'm', items };
  });
}

/* -------------------------------------------------------------------------- */
/* manifest.json                                                               */
/* -------------------------------------------------------------------------- */

/** The generated manifest (v3). */
export interface SystemManifest {
  manifestVersion: 3;
  files: string[];
  name: string;
  namespace: string;
  libraries: Library[];
  components: { name: string; group?: string; summary?: string; page?: boolean }[];
  lastChange?: LastChange;
  assetGroups: { name: string; tile?: TileSize; order?: string[]; files?: { path: string; id: string }[] }[];
  sections?: Record<string, string>;
  [key: string]: unknown;
}

/** Generates `manifest.json`, carrying the islands of the previous one. */
export function buildManifest(index: SystemIndex, files: ReadonlyMap<string, string>, previous?: Partial<SystemManifest>): SystemManifest {
  const manifest: SystemManifest = {
    manifestVersion: 3,
    name: index.title,
    namespace: index.namespace || parseBundleHeader(files.get('components/bundle.js') ?? '')?.namespace || toNamespace(index.title),
    files: [...new Set([...files.keys()].filter((path) => {
      const role = fileRole(path);
      if (['bundle', 'bundle-css', 'types', 'component-readme', 'component-types', 'library', 'font', 'section'].includes(role)) return true;
      return role === 'asset' && path.endsWith('/README.md');
    }).concat(files.has('tokens.json') ? ['tokens.css'] : []))].sort(),
    libraries: index.libraries,
    components: listComponents(files).filter(({ name }) => name !== 'Cover').map(({ name, group, summary, page }) => ({
      name,
      ...(group ? { group } : {}),
      ...(summary ? { summary } : {}),
      ...(page ? { page } : {}),
    })),
    assetGroups: listAssets(index, files.keys()).filter((group) => group.items.length || files.has(`assets/${group.name}/README.md`)).map((group) => {
      const key = assetGroupKey(index.assetGroups, group.name);
      const record = index.assetGroups[key];
      const uploads = group.items.filter((item) => item.blob).map((item) => ({ path: `assets/${group.name}/${item.name}`, id: item.blob! }));
      return {
        name: group.name,
        ...(record?.tile ? { tile: record.tile } : {}),
        ...(record?.order?.length ? { order: record.order } : {}),
        ...(uploads.length ? { files: uploads } : {}),
      };
    }),
  };
  if (index.lastChange) manifest.lastChange = index.lastChange;
  if (previous?.storage) manifest.storage = previous.storage;
  const sections = Object.keys(index.sections).length ? index.sections : previous?.sections;
  if (sections && Object.keys(sections).length) manifest.sections = sections;
  return manifest;
}
