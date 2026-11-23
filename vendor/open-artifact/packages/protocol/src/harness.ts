/**
 * The Harness API: how a harness adapter (a plugin inside an agent harness)
 * talks to the daemon.
 *
 * Transport: JSON-RPC 2.0 over a WebSocket at `<daemon>/__harness`, with the
 * subprotocol {@link HARNESS_SUBPROTOCOL}. Both sides call: the adapter calls
 * the daemon ({@link AdapterToDaemon}) and the daemon calls the adapter
 * ({@link DaemonToAdapter}). The first call must be `hello` with the daemon
 * token from `daemon.json`.
 *
 * Adapters that cannot hold a socket use the HTTP polling API instead
 * ({@link POLL_ROUTES}): the same methods as `POST /api/open-artifact.session.*`, and
 * `session.wait` long-polls for wakes.
 */

import type { OpenArtifactErrorBody } from './errors.ts';
import type { HarnessInfo, LibraryEvent, OwnerStatus } from './library.ts';
import type { SessionRef } from './refs.ts';
import type { ToolCallResult, ToolDefinition, ToolName } from './tools.ts';
import type { WakeDeliverStatus, WakePayload } from './wake.ts';

/** WebSocket path of the Harness API. */
export const HARNESS_PATH = '/__harness';

/** WebSocket subprotocol of the Harness API. */
export const HARNESS_SUBPROTOCOL = 'open-artifact-harness';

/** What an adapter can do, said in `hello`. */
export interface AdapterCaps {
  /** The adapter takes `wake.deliver`. `resume`: it can resume a session with no live agent. */
  wake?: { resume?: boolean };
  /** The adapter takes `host.open` (shows an artifact in the harness's own UI). */
  open?: boolean;
  /** What the harness calls its agent, e.g. `Agent`. */
  agentName?: string;
}

/** Agent state of an attached session. */
export type SessionStatus = 'idle' | 'running';

/** `hello` params. */
export interface HelloParams {
  harness: string;
  caps?: AdapterCaps;
  token: string;
}

/** `hello` result. */
export interface HelloResult {
  protocol: 1;
  daemon: string;
  connection: string;
}

/** Names a session of the calling harness. */
export interface SessionParams {
  session?: string | null;
  workspace?: string | null;
}

/** `session.attach` params. */
export interface AttachParams extends SessionParams {
  title?: string;
  status?: SessionStatus;
  /** Process id of the agent, so MCP calls from its children map to this session. */
  pid?: number;
}

/** One message that waited in a session's inbox. */
export interface InboxMessage extends Partial<WakePayload> {
  kind: 'wake' | (string & {});
  text: string;
  /** When it was queued (ISO). */
  at: string;
}

/** A caller override for `tools.call` and friends. */
export interface CallerParams {
  caller?: SessionParams;
}

/** Methods the adapter calls on the daemon: params and result of each. */
export interface AdapterToDaemon {
  hello: { params: HelloParams; result: HelloResult };
  'session.attach': { params: AttachParams; result: { key: string; inbox: InboxMessage[] } };
  'session.status': { params: SessionParams & { status: SessionStatus }; result: { ok: true } };
  'session.detach': { params: SessionParams; result: { ok: true } };
  'session.rename': { params: SessionParams & { title: string }; result: { ok: true } };
  'tools.list': { params: Record<string, never>; result: { tools: ToolDefinition[] } };
  'tools.call': { params: { name: ToolName | (string & {}); arguments: Record<string, unknown> } & CallerParams; result: ToolCallResult };
  /** The agent wrote these files (absolute paths) with its own tools. */
  'agent.wrote': { params: { paths: string[] } & CallerParams & SessionParams; result: { ok: true; artifacts?: string[] } };
  'artifact.open': { params: { url: string } & CallerParams & SessionParams; result: { opened: boolean; view_url?: string } };
  'inbox.take': { params: SessionParams & CallerParams; result: { messages: InboxMessage[] } };
  'inbox.wait': { params: SessionParams & CallerParams & { timeoutMs?: number }; result: { messages: InboxMessage[] } };
  /** Turns {@link HarnessEvent}s on or off. */
  subscribe: { params: { on: boolean }; result: { ok: true } };
}

/** `wake.deliver` params: the payload plus the target session. */
export interface WakeDeliverParams extends WakePayload {
  session: string | null;
  workspace: string | null;
}

/** `host.open` params. */
export interface HostOpenParams {
  session: string | null;
  url: string;
  view_url: string;
  title?: string;
}

/** Methods the daemon calls on the adapter. */
export interface DaemonToAdapter {
  'wake.deliver': { params: WakeDeliverParams; result: { status: WakeDeliverStatus } };
  'host.open': { params: HostOpenParams; result: { opened: boolean } };
}

/** Events pushed to subscribed adapters as the `event` notification. */
export type HarnessEvent = LibraryEvent;

/** Handlers an adapter registers for the daemon's calls. */
export type DaemonCallHandlers = {
  [M in keyof DaemonToAdapter]?: (params: DaemonToAdapter[M]['params']) => Promise<DaemonToAdapter[M]['result']> | DaemonToAdapter[M]['result'];
};

/** A JSON-RPC request or notification. */
export interface RpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: P;
}

/** A JSON-RPC response. */
export interface RpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: R;
  error?: { code: number; message: string; data?: Partial<OpenArtifactErrorBody> };
}

/** JSON-RPC error codes the daemon and adapters use. */
export const RPC_ERRORS = {
  parse: -32700,
  methodNotFound: -32601,
  invalidParams: -32602,
  server: -32000,
} as const;

/**
 * HTTP polling adapter routes (`POST`, `Authorization: Bearer <token>`,
 * header `X-Open-Artifact-Harness: <name>`).
 */
export const POLL_ROUTES = {
  attach: '/api/open-artifact.session.attach',
  /** Long-poll: answers with the next wakes for the session, or `[]` after the timeout. */
  wait: '/api/open-artifact.session.wait',
  status: '/api/open-artifact.session.status',
  detach: '/api/open-artifact.session.detach',
  tools: '/api/open-artifact.tools',
  toolsCall: '/api/open-artifact.tools.call',
} as const;

/**
 * A harness profile (`harnesses/<name>.json` in the daemon): what the daemon
 * knows about a harness before its adapter connects.
 */
export interface HarnessProfile {
  name: string;
  title: string;
  /** What the harness calls its agent. */
  agentName: string;
  /** Integration level: L1 MCP only, L2 MCP + hooks, L3 a full adapter. */
  level: 'L1' | 'L2' | 'L3';
  /** How the harness reaches the daemon. */
  entry: 'harness-api' | 'mcp' | 'mod';
  /** Package name of the harness plugin, when there is one. */
  plugin?: string;
  /** How to start the MCP bridge, for MCP-entry harnesses. */
  mcp?: { command: string; args: string[] };
  /** Environment variable that holds the session id in a tool's process. */
  sessionEnv?: string;
  /** Where the harness looks for skills. */
  skillsDir?: string;
  /** Wake routes the harness supports, in order. */
  wake: Array<'live' | 'inbox'>;
  /**
   * false: the daemon cannot start a turn in an idle session (no adapter, monitor or command for it), so what the
   * person sends waits for the session's next turn, which they start. Left out: it can.
   */
  wakesIdle?: boolean;
  /**
   * Where the daemon shows a page the agent opens (`Artifact open`, or `open: "after_first_write"`) when no adapter
   * of the harness can (`host.open`): `browser`, the browser of this computer. Left out: nowhere; the agent gives
   * the person the link.
   */
  open?: 'browser';
}

/** One adapter connection, as `GET /api/open-artifact.harnesses` lists it. */
export interface AdapterInfo {
  /** Connection id. */
  id: string;
  harness: string;
  caps: AdapterCaps;
  /** Keys of the sessions attached through it. */
  sessions: string[];
  /** An HTTP polling adapter rather than a WebSocket. */
  polling: boolean;
}

/** `GET /api/open-artifact.harnesses`: the harnesses, their adapters and the sessions the daemon knows. */
export interface HarnessesResponse {
  harnesses: HarnessInfo[];
  adapters: AdapterInfo[];
  sessions: Array<SessionRef & { key: string; status: OwnerStatus; live: boolean; title?: string }>;
}
