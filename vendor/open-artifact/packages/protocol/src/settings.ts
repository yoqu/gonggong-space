/**
 * `~/.agents/open-artifact/settings.json`: settings shared by every
 * harness on this computer. Only what the person changed is saved; the
 * daemon merges the file over {@link DEFAULT_SETTINGS}.
 */

/** A marketplace source. */
export type MarketplaceSource = { source: 'github'; repo: string; ref?: string } | { source: 'git'; url: string; ref?: string } | { source: 'directory'; path: string };

/** Settings. */
export interface OpenArtifactSettings {
  /** Where types are looked for. `~` is expanded. */
  typeRoots: { user: string; project: string; extra: string[] };
  marketplaces: Record<string, { source: MarketplaceSource; autoUpdate?: boolean }>;
  /** When set, only these marketplaces may be added. */
  allowedMarketplaces: string[] | null;
  /** Type ids that are installed but turned off. */
  disabledTypes: string[];
  /** Feature flags by name, over each type's defaults. */
  flags: Record<string, boolean>;
  wake: {
    /** What to do with a wake for a session nobody can reach. */
    fallback: 'ask' | 'inbox';
  };
  /** Preferred daemon port. */
  serverPort: number;
  /** Folder under a workspace where new artifacts go. */
  artifactsDir: string;
  /** Workspace of artifacts made without a session (from the home page). */
  homeWorkspace: string;
  /** Project folders whose `.agents/artifact-types` may run code. */
  trustedProjects: string[];
  /** Type ids whose `openArtifact.offer` goes into the agent prompt: the agent may offer them unasked. */
  offers: string[];
  /**
   * Per cloud remote (by its name in `remotes.json`): `agentMayPublish` lets the agent's `Artifact {action: "share",
   * cloud: "<name>"}` publish an artifact there (off by default: only the person publishes).
   */
  remotes?: Record<string, { agentMayPublish?: boolean }>;
  /**
   * Publishing to the cloud as a whole. A sibling of {@link remotes} rather than a key inside it, so it can never
   * collide with a remote's name (a remote may well be called `default`). Only a person changes it (the CLI's
   * `remote default` / `remote auto`, or the Share panel), never an agent's tool.
   */
  cloud?: CloudSettings;
}

/** {@link OpenArtifactSettings.cloud}. */
export interface CloudSettings {
  /**
   * The remote (its name in `remotes.json`) used when none is named: `open-artifact publish <id>`, the Share panel's
   * Publish and automatic publishing. Unset: the only remote, when there is exactly one. The first remote added
   * becomes it.
   */
  default?: string;
  /**
   * `manual` (the default): only what a person publishes goes to the cloud. `auto`: every artifact created from then on
   * (by an agent, the home page or adopt) is published to the default remote by itself, in the background; artifacts
   * made before, and any the person unpublished, are left alone. Preset by `OPEN_ARTIFACT_PUBLISH` or `preset.json`
   * when the file does not set it.
   */
  publish?: CloudPublishMode;
  /**
   * How often, in minutes, the daemon runs a published dashboard's live queries again for its host while it is linked
   * ({@link DEFAULT_DATA_REFRESH_MINUTES} when unset); `0` never does (it still does when the dashboard is published and
   * when someone asks).
   */
  dataRefresh?: number;
}

/**
 * {@link CloudSettings.dataRefresh}'s default: every 6 hours. Each refresh runs every live query of every published
 * dashboard on the owner's warehouse (billed per query on most), so the timer is a safety net, not a live feed; people
 * who need newer figures press Refresh.
 */
export const DEFAULT_DATA_REFRESH_MINUTES = 360;

/** {@link CloudSettings.publish}. */
export type CloudPublishMode = 'manual' | 'auto';

/** Defaults. */
export const DEFAULT_SETTINGS: OpenArtifactSettings = {
  typeRoots: { user: '~/.agents/artifact-types', project: '.agents/artifact-types', extra: [] },
  marketplaces: {
    'open-artifact': { source: { source: 'github', repo: 'JimLiu/open-artifact' }, autoUpdate: true },
  },
  allowedMarketplaces: null,
  disabledTypes: [],
  flags: {},
  wake: { fallback: 'ask' },
  serverPort: 4800,
  artifactsDir: 'artifacts',
  homeWorkspace: '~/OpenArtifact',
  trustedProjects: [],
  offers: [],
};
