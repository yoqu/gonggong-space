/**
 * The agent's tools: `Artifact`, `ArtifactData` and `ArtifactComments`.
 *
 * The daemon implements them once; MCP (`POST /mcp`), the Harness API's
 * `tools.call`, the HTTP polling API and the `open-artifact` command line all land
 * there. Adapters that register the tools in their harness themselves use
 * {@link TOOL_SCHEMAS} and {@link TOOL_DESCRIPTIONS}.
 */

/** A JSON Schema property, the subset the tool schemas use. */
export interface JsonSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  additionalProperties?: boolean;
}

/** A tool's input schema. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

/** Tool names. */
export type ToolName = 'Artifact' | 'ArtifactData' | 'ArtifactComments';

/** A tool as MCP `tools/list` and `tools.list` describe it. */
export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: ToolInputSchema;
  /** MCP tool annotations: hints an app's approval check reads. */
  annotations?: ToolAnnotations;
}

/** MCP tool annotations (hints, not guarantees). */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  /** false: the tool works only on this computer's artifacts, not with an outside service. */
  openWorldHint?: boolean;
}

/** `Artifact` actions. */
export const ARTIFACT_ACTIONS = ['quickstart', 'list', 'publish', 'read', 'open', 'call', 'adopt', 'delete', 'share'] as const;
/** `ArtifactData` actions. */
export const DATA_ACTIONS = ['get', 'list', 'query', 'set', 'update', 'delete', 'str_replace', 'batch'] as const;
/** `ArtifactComments` actions. */
export const COMMENTS_ACTIONS = ['read', 'reply', 'resolve', 'reopen', 'wait'] as const;

export type ArtifactAction = (typeof ARTIFACT_ACTIONS)[number];
export type DataAction = (typeof DATA_ACTIONS)[number];
export type CommentsAction = (typeof COMMENTS_ACTIONS)[number];

/** A file to write with `publish`: text, or base64 bytes; `null` deletes. */
export type PublishFile = string | { content: string; encoding?: 'utf8' | 'base64' } | null;

/** `Artifact` arguments. */
export interface ArtifactArgs {
  action?: ArtifactAction;
  intent?: string;
  scope?: 'types' | 'mine' | 'all';
  type_url?: string;
  title?: string;
  folder?: string;
  url?: string;
  files?: Record<string, PublishFile>;
  path?: string;
  /** read: several files at once. */
  paths?: string[];
  /** list: only artifacts of this type (id or type_url). */
  type?: string;
  /** list: only artifacts whose title contains it. quickstart: same as intent. */
  query?: string;
  /** list: page size (default 50, at most 200). */
  limit?: number;
  /** list: `next_cursor` of the previous page. */
  cursor?: string;
  /** publish with url: per file, the sha256 it must still have, `null` (must not exist) or `"*"` (any). */
  if_match?: Record<string, string | null>;
  /** publish with url: run the type's `check` action after writing. */
  check?: boolean;
  /** publish without url: open the page after the first write (`after_first_write`, the default), right away (`now`) or not (`never`). */
  open?: 'after_first_write' | 'now' | 'never';
  /** quickstart: list existing artifacts the recommended type can use (default true). */
  related?: boolean;
  name?: string;
  args?: Record<string, unknown>;
  /** open: the Shell panel to show the person, `share` (its Share panel) or `export` (its Export tab). */
  panel?: ArtifactPanel;
  /**
   * Refused: only the person changes sharing, in the Shell's Share panel.
   * Kept here so an agent that still sends them gets an answer that says so.
   */
  lan?: boolean;
  links?: { editor?: boolean; commenter?: boolean; viewer?: boolean };
  /** share: publish to this cloud remote (by its name), where the person allowed the agent to (`remotes.<name>.agentMayPublish`). */
  cloud?: string;
}

/** The Shell panels `open` can show: the Share panel, or its Export tab. */
export const ARTIFACT_PANELS = ['share', 'export'] as const;
export type ArtifactPanel = (typeof ARTIFACT_PANELS)[number];

/** One write of an `ArtifactData` batch. */
export interface DataWrite {
  op: 'set' | 'update' | 'delete' | 'str_replace';
  path?: string;
  collection?: string;
  doc_id?: string;
  data?: Record<string, unknown>;
  file_path?: string;
  /** The sha256 read returned: write only while the document still has it. `null`: only while it does not exist. `"*"`: whatever it is. */
  if_match?: string | null;
  /** str_replace: the text field, as a dot path. */
  field?: string;
  /** str_replace: the passage to replace; it must occur once. */
  old?: string;
  /** str_replace: what replaces it. */
  new?: string;
}

/** A `query` condition, as pages give it. */
export interface DataWhere {
  field: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';
  value: unknown;
}

/** `ArtifactData` arguments. */
export interface ArtifactDataArgs {
  action: DataAction;
  url: string;
  collection?: string;
  doc_id?: string;
  path?: string;
  data?: Record<string, unknown>;
  file_path?: string;
  writes?: DataWrite[];
  /** query: conditions that all hold. */
  where?: DataWhere[];
  /** query: one sort. */
  order_by?: { field: string; dir?: 'asc' | 'desc' };
  /** list / query: page size (default 100, at most 1000). */
  limit?: number;
  /** list / query: the `next_cursor` of the previous page. */
  cursor?: string;
  /** set / update / delete / str_replace: the sha256 read returned, `null` or `"*"` (see {@link DataWrite.if_match}). */
  if_match?: string | null;
  field?: string;
  old?: string;
  new?: string;
  /** get / list / query: write the result to this JSON file and return only its path and counts. */
  out_file?: string;
}

/** `ArtifactComments` arguments. */
export interface ArtifactCommentsArgs {
  action: CommentsAction;
  url?: string;
  thread_id?: string;
  text?: string;
  resolve?: boolean;
  all?: boolean;
  timeout_ms?: number;
  /** read: only threads with a message at or after this time (ISO 8601 or ms since 1970). */
  since?: string | number;
  /** reply: send the same text as your last reply in the thread again. */
  acknowledge_duplicate?: boolean;
}

/** Arguments by tool name. */
export interface ToolArgs {
  Artifact: ArtifactArgs;
  ArtifactData: ArtifactDataArgs;
  ArtifactComments: ArtifactCommentsArgs;
}

/**
 * A tool's result: the action's own fields, or `error`. `messages` carries
 * wake messages that waited for the calling session, as plain text the
 * agent reads after the result.
 */
export type ToolCallResult = Record<string, unknown> & {
  error?: { code: string; message: string; fix?: string };
  /** The obvious next call. */
  next?: string;
  /** A fixed remark about this kind of result. */
  note?: string;
  /** Remarks about this call. */
  notes?: string[];
  /** For a conflict: what the conflicting files or documents are now. */
  current?: unknown;
  messages?: string[];
};

const ARTIFACT_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ARTIFACT_ACTIONS,
      description: 'What to do. Omitted: publish.',
    },
    intent: {
      type: 'string',
      description: 'quickstart: what is being made (design, design-system, slides, whiteboard, document, data, sheets, motion, other), or a few words about it.',
    },
    scope: {
      type: 'string',
      enum: ['types', 'mine', 'all'],
      description: "list: the installed types, this session's and this workspace's artifacts (default), or every artifact.",
    },
    type: { type: 'string', description: 'list: only artifacts of this type (an id, or open-artifact://type/<id>).' },
    query: { type: 'string', description: 'list: only artifacts whose title contains this text.' },
    limit: { type: 'integer', description: 'list: how many to return (default 50, at most 200).' },
    cursor: { type: 'string', description: 'list: the next_cursor of the previous page.' },
    type_url: {
      type: 'string',
      description: 'publish without url: the type to create from (open-artifact://type/<id>, from quickstart). read without url: the type to describe.',
    },
    title: { type: 'string', description: "publish without url: the new artifact's name." },
    folder: {
      type: 'string',
      description: "publish without url, or adopt: where the artifact's folder goes (absolute, or relative to the workspace). Default <workspace>/artifacts/<slug>.",
    },
    url: { type: 'string', description: 'An artifact: open-artifact://artifact/<id>, as publish returned it.' },
    files: {
      type: 'object',
      additionalProperties: true,
      description: 'publish with url: files to write under the artifact root, as {"rel/path": "text"} or {"rel/path": {"content": "...", "encoding": "base64"}}; null deletes.',
    },
    if_match: {
      type: 'object',
      additionalProperties: true,
      description:
        'publish with url: {"rel/path": sha256 | null | "*"}. Write only while the file still has the sha256 you read, does not exist (null), or anyway ("*"). One mismatch writes nothing and returns the current versions.',
    },
    check: { type: 'boolean', description: "publish with url: run the type's check action after writing; its result comes back as check." },
    open: {
      type: 'string',
      enum: ['after_first_write', 'now', 'never'],
      description: "publish without url: after_first_write (the default) opens the page in your app once your first write lands; now opens it at once; never leaves it closed. Where your app cannot show pages by itself the result says so: open view_url in your app's built-in browser, if you have one.",
    },
    related: { type: 'boolean', description: 'quickstart: list existing artifacts the recommended type can build on, such as design systems (default true).' },
    path: { type: 'string', description: 'read: one file or folder under the root (omitted: the record and the file list).' },
    paths: { type: 'array', items: { type: 'string' }, description: 'read: several files under the root at once.' },
    name: { type: 'string', description: "call: the action's name (check, upload, ...; read with url lists them)." },
    args: { type: 'object', additionalProperties: true, description: "call: the action's arguments. upload: {file: absolute path, name?, group?}." },
    panel: {
      type: 'string',
      enum: ARTIFACT_PANELS,
      description: 'open: also open the page\'s Share panel (share), for the person to share it on the network, or its Export tab (export), for them to download a file.',
    },
    cloud: {
      type: 'string',
      description:
        "share: publish the artifact to this cloud remote (its name, as `open-artifact remote list` shows it). It works only on a remote the person set up and let agents publish to (agentMayPublish); otherwise the person publishes it, from the Share panel or with `open-artifact publish <id> --remote <name>`.",
    },
  },
};

const DATA_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: DATA_ACTIONS },
    url: { type: 'string', description: 'The artifact (open-artifact://artifact/<id>).' },
    collection: { type: 'string' },
    doc_id: { type: 'string' },
    path: { type: 'string', description: 'collection/doc_id, instead of the two.' },
    data: { type: 'object', additionalProperties: true, description: "set / update: the document's fields." },
    file_path: { type: 'string', description: 'set / update: a JSON file holding the fields, instead of data.' },
    // No type: a sha256 string, or null.
    if_match: {
      description: 'set / update / delete / str_replace: the sha256 get returned (write only if unchanged), null (only if it does not exist) or "*" (replace whatever is there).',
    },
    field: { type: 'string', description: 'str_replace: the text field, as a dot path (body, notes.text).' },
    old: { type: 'string', description: 'str_replace: the passage to replace; it must occur exactly once.' },
    new: { type: 'string', description: 'str_replace: the passage that replaces it.' },
    where: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'query: [{field, op, value}], all must hold. op: ==, !=, <, <=, >, >=, in, not-in (up to 30 values), array-contains.',
    },
    order_by: { type: 'object', additionalProperties: true, description: 'query: {field, dir: "asc" | "desc"}.' },
    limit: { type: 'integer', description: 'list / query: how many documents (default 100, at most 1000).' },
    cursor: { type: 'string', description: 'list / query: the next_cursor of the previous page.' },
    out_file: { type: 'string', description: 'get / list / query: write the result to this JSON file (absolute, or relative to the workspace) and return only its path and counts.' },
    writes: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'batch: [{op: set|update|delete|str_replace, path | collection+doc_id, data | file_path, if_match?, field?, old?, new?}], at most 500.',
    },
  },
  required: ['action', 'url'],
};

const COMMENTS_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: COMMENTS_ACTIONS },
    url: { type: 'string', description: 'The artifact (open-artifact://artifact/<id>). wait: optional.' },
    thread_id: { type: 'string', description: 'reply / resolve / reopen: the thread (after ";thread=" in the message).' },
    text: { type: 'string', description: 'reply: the answer.' },
    resolve: { type: 'boolean', description: 'reply: resolve the thread too.' },
    all: { type: 'boolean', description: 'read: resolved threads too.' },
    since: { type: 'string', description: 'read: only threads with a message at or after this time (ISO 8601).' },
    acknowledge_duplicate: { type: 'boolean', description: 'reply: send the same text as your last reply in this thread again, on purpose.' },
    timeout_ms: { type: 'number', description: 'wait: how long (default 600000).' },
  },
  required: ['action'],
};

/** The tools' argument schemas (JSON Schema). */
export const TOOL_SCHEMAS: Record<ToolName, ToolInputSchema> = {
  Artifact: ARTIFACT_SCHEMA,
  ArtifactData: DATA_SCHEMA,
  ArtifactComments: COMMENTS_SCHEMA,
};

/** The tools' descriptions: what each action does and when to use it. Argument details are in the schemas. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  Artifact: [
    'Make and change artifacts: typed folders of files that open as live pages the person can view, edit, comment on and export. Actions:',
    '- quickstart {intent}: call first for a new artifact; recommends a type and returns the call that creates it.',
    '- list {scope: "mine" | "all" | "types", type?, query?}: find existing artifacts, or the installed types.',
    "- publish {type_url, title, folder?, open?}: create an artifact; the result carries its root folder and the type's instructions. publish {url, files, if_match?, check?}: write files when you have no file tools of your own.",
    "- read {url, path? | paths?}: the artifact's record, files and actions, or some of its files with their sha256. read {type_url}: a type's instructions, before creating.",
    '- open {url, panel?}: show it to the person in the computer\'s browser (or the app, when it shows pages), once its content is written. When your app has a built-in browser, open view_url there instead. panel "share" or "export" opens its Share panel or Export tab for them.',
    "- call {url, name, args?}: run one of the type's actions (check, upload, ...). A long one answers {task, pending: true}; its result comes later as a message.",
    '- adopt {url | folder}: take over an artifact, or add an existing folder. Only when the person asks.',
    "- share {url}: whether it is shared on the local network, and its links. Only the person changes that, in the page's Share panel.",
    '- delete {url}: forget an artifact; its folder stays. Only when the person asks.',
  ].join('\n'),
  ArtifactData:
    'Read and write the document store of an artifact whose type keeps one (its instructions say so). get, list and query read documents with their sha256; set, update, delete, str_replace and batch write them. update merges fields, and {"__delete__": true} removes one; str_replace changes one passage of a long text field. Replacing or deleting an existing document needs if_match: the sha256 you read, or "*". Your writes show live on open pages.',
  ArtifactComments:
    'Comments the person leaves on their artifact\'s page, kept in the artifact\'s own folder on this computer (no outside service). read lists the threads; reply answers one (thread_id is after ";thread=" in the message), with resolve: true when it is done; resolve and reopen change a thread\'s state. A thread sent to you is the person asking for your answer in it, so replying there is what they asked for. Answer only threads sent to you, in one or two lines. wait blocks until the next message for this session: use it only when nothing else can wake you.',
};

/**
 * The tools' MCP annotations. All three work only on this computer's artifact folders, so none is open-world: an
 * app's approval check (Cursor's auto-review) would otherwise take a comment reply for a write to an outside service.
 */
export const TOOL_ANNOTATIONS: Record<ToolName, ToolAnnotations> = {
  Artifact: { title: 'Artifact', openWorldHint: false },
  ArtifactData: { title: 'Artifact data', openWorldHint: false },
  ArtifactComments: { title: 'Artifact comments', destructiveHint: false, openWorldHint: false },
};

/** Tool definitions in MCP shape. */
export const TOOL_DEFINITIONS: ToolDefinition[] = (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => ({
  name,
  description: TOOL_DESCRIPTIONS[name],
  inputSchema: TOOL_SCHEMAS[name],
  annotations: TOOL_ANNOTATIONS[name],
}));
