/**
 * `artifact-type.json`: the manifest of an Artifact Type folder.
 *
 * Every field is optional. A folder is a type when its name is a valid type
 * id and it holds an `index.html` or an `artifact-type.json`. Missing values
 * fall back to the folder name (id) and to the `SKILL.md` frontmatter (name,
 * description).
 */

/** Localized overrides of the display fields, keyed by BCP 47 tag. */
export type ManifestI18n = Record<string, Partial<Pick<ArtifactTypeManifest, 'name' | 'title' | 'summary' | 'description' | 'artifactTitle'>>>;

/** A start prompt the home page offers for a type. */
export interface ManifestTemplate {
  id: string;
  name: string;
  prompt: string;
}

/**
 * How the daemon starts a local type server: `command` with `args`, run in
 * the type folder, with `env` added to the `OPEN_ARTIFACT_*` variables.
 */
export interface EntryStart {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Which `/__open-artifact/*` routes a type server implements. Routes not declared are
 * never called.
 */
export interface EntryFlags {
  /** `POST /__open-artifact/open` and `/__open-artifact/close`: the server opens one page per artifact. */
  open?: boolean;
  /** `POST /__open-artifact/share`: the server shares artifacts on the LAN. */
  share?: boolean;
  /** `POST /__open-artifact/actions/<name>`: the server answers the agent's `call` actions. */
  actions?: boolean;
}

/**
 * A URL entry: the page lives at `url`, a template with `{id}`, `{lang}`
 * and (loopback addresses only) `{root}`.
 */
export interface UrlEntry extends EntryFlags {
  url: string;
}

/**
 * A server entry: the daemon starts the type server with `start`. `url`,
 * when given, is the server's base address (loopback only); otherwise the
 * server reports its address in the ready line.
 */
export interface ServerEntry extends EntryFlags {
  start: EntryStart;
  url?: string;
}

/**
 * The `entry` field: a static HTML file in the type folder, or a URL / server
 * entry.
 */
export type ManifestEntry = string | UrlEntry | ServerEntry;

/** Host-specific hints a type may add under `open-artifact`. Unknown keys are kept. */
export interface ManifestHostHints {
  /** `project`: the artifact's content lives under {@link projectDir}. */
  style?: 'project' | (string & {});
  /** Folder under the artifact root that holds the type's files. */
  projectDir?: string;
  /** Document store the type keeps (`null`: none). */
  store?: string | null;
  /** The type keeps comments in `comments.json`. */
  comments?: boolean;
  /** Formats the page exports, e.g. `["pdf", "pptx"]`: the agent prompt lists them. */
  exports?: string[];
  /** One sentence on when an agent may offer this type unasked; used only when the person allows it (`settings.offers`). */
  offer?: string;
  /**
   * Types whose artifacts this one builds on, e.g. `["design-system"]`:
   * quickstart lists the person's artifacts of those types as `related`.
   */
  uses?: string[];
  /**
   * The page is worth opening right after the first playable batch (e.g. a rough cut) so the person watches
   * progress live as later writes land, rather than waiting until everything is written and checked.
   */
  openEarly?: boolean;
  [key: string]: unknown;
}

/** `artifact-type.json`. */
export interface ArtifactTypeManifest {
  /** Stable id; defaults to the folder name. */
  slug?: string;
  /** Display name, e.g. `Design`. */
  name?: string;
  /** Longer display title. */
  title?: string;
  description?: string;
  /** One-line summary for lists. */
  summary?: string;
  /** Default title of a new artifact, e.g. `Untitled design`. */
  artifactTitle?: string;
  category?: string;
  icon?: { file: string };
  /** Version of the type, free form (semver or a date). */
  version?: string;
  i18n?: ManifestI18n;
  /** Skill file, relative to the folder; `false`: the type registers no skill. */
  skill?: string | false;
  /** Slash command name; defaults to the id. */
  command?: string;
  /** What the type is for (`design`, `slides`…), matched by `quickstart`. */
  intents?: string[];
  /** When an agent should pick this type, in a sentence. */
  when?: string;
  templates?: ManifestTemplate[];
  /** Feature flag defaults. */
  flags?: Record<string, boolean>;
  /** Files whose presence marks an artifact of this type as written. */
  detect?: string[];
  /** Where the title is read from, as `<file>#<json pointer>`. */
  titleFrom?: string;
  /** Types this one needs installed (ids). */
  dependencies?: string[];
  entry?: ManifestEntry;
  /** Required protocol version, e.g. `{ "openArtifact": ">=1" }`. */
  engines?: { openArtifact?: string };
  openArtifact?: ManifestHostHints;
}

/** The entry a daemon resolved from a manifest. */
export type ResolvedEntry =
  | { kind: 'static'; file: string }
  | { kind: 'url'; url: string; open: boolean; share: boolean; actions: boolean }
  | { kind: 'server'; start: Required<EntryStart>; url: string | null; open: boolean; share: boolean; actions: boolean };

/**
 * How a type runs. `frame`: an original hosted artifact type (an
 * index.html with an inline `// artifact.json` block and no `entry`), served
 * by frame-host as a `server` entry.
 */
export type TypeRuntime = 'static' | 'url' | 'server' | 'frame';

/** Where a type was found. */
export type TypeScope = 'project' | 'user' | 'extra' | 'builtin';

/** True for a {@link ServerEntry}. */
export function isServerEntry(entry: ManifestEntry | undefined): entry is ServerEntry {
  return !!entry && typeof entry === 'object' && 'start' in entry && !!entry.start;
}

/** True for a {@link UrlEntry} (without `start`). */
export function isUrlEntry(entry: ManifestEntry | undefined): entry is UrlEntry {
  return !!entry && typeof entry === 'object' && !isServerEntry(entry) && typeof (entry as UrlEntry).url === 'string';
}
