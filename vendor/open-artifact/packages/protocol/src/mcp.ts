/**
 * The transport-neutral part of Open Artifact's MCP servers: protocol versions, the JSON-RPC shapes and one function,
 * {@link serveMcp}, that answers one message. The daemon's `/mcp` (loopback, the daemon token) and the cloud host's
 * `/mcp` (OAuth) both use it, each with its own tools and its own idea of who calls.
 *
 * It lives here rather than in the daemon because the host may not import the daemon; it has no Node imports.
 *
 * Revisions: this speaks the `initialize` era of MCP (2024-11-05 to 2025-11-25). A client that names another
 * revision is told the versions it can use, so a client that also speaks the earlier era falls back to `initialize`.
 */

import { RPC_ERRORS } from './harness.ts';
import type { ToolCallResult, ToolDefinition } from './tools.ts';

/** The revision answered when a client names none it shares with us. */
export const MCP_PROTOCOL = '2025-06-18';

/** Revisions understood, newest first. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** The HTTP header a client sends its revision in after `initialize` (Streamable HTTP). */
export const MCP_PROTOCOL_HEADER = 'mcp-protocol-version';

/** The revision a client is assumed to speak when it sends no {@link MCP_PROTOCOL_HEADER}. */
export const MCP_DEFAULT_HTTP_PROTOCOL = '2025-03-26';

/** Whether `version` is one of {@link MCP_PROTOCOL_VERSIONS}. */
export function isSupportedProtocol(version: unknown): version is string {
  return typeof version === 'string' && MCP_PROTOCOL_VERSIONS.includes(version);
}

/** The revision `initialize` answers: the client's when we speak it, else {@link MCP_PROTOCOL}. */
export function negotiateProtocol(requested: unknown): string {
  return isSupportedProtocol(requested) ? requested : MCP_PROTOCOL;
}

/** `_meta` fields an MCP client may pass to name its session. */
export interface McpMeta {
  harness?: string;
  sessionId?: string;
  threadId?: string;
  conversationId?: string;
  workspace?: string;
}

/** A JSON-RPC message from an MCP client. */
export interface McpMessage {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown> & {
    _meta?: McpMeta;
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
    capabilities?: unknown;
    uri?: string;
  };
}

/** A JSON-RPC answer. */
export interface McpReply {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** A JSON-RPC error answer with no request to name (a body that was not JSON-RPC at all). */
export function mcpError(code: number, message: string, id: string | number | null = null, data?: unknown): McpReply {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** A tool result as `tools/call` answers it: the result as JSON text, then each waiting message as its own text. */
export function toolCallContent(result: ToolCallResult | null | undefined, structured = false): Record<string, unknown> {
  const isError = !!result?.error && Object.keys(result).filter((k) => k !== 'messages').length === 1;
  const { messages, ...rest } = result ?? {};
  const content = [{ type: 'text', text: JSON.stringify(rest, null, 2) }];
  for (const text of messages ?? []) content.push({ type: 'text', text });
  return { content, isError, ...(structured && !isError ? { structuredContent: rest } : {}) };
}

/** What {@link serveMcp} needs from a server. */
export interface McpEndpoint {
  /** The server's version, for `serverInfo`. */
  version: string;
  /** Whether this message's client shows MCP Apps, from its `initialize` capabilities or the transport. */
  apps(method: string, capabilities: unknown): boolean;
  instructions(apps: boolean): string;
  tools(apps: boolean): Array<ToolDefinition | Record<string, unknown>>;
  call(name: string, args: Record<string, unknown>, meta: McpMeta): Promise<ToolCallResult>;
  /** Tools whose result also goes in `structuredContent` (an MCP App reads it). */
  structured?(name: string): boolean;
  /** The server's resources (MCP Apps' views); none when absent. */
  resources?: {
    list(): unknown[];
    read(uri: string): unknown | null;
  };
}

/** One JSON-RPC message → its answer (`null` for a notification). */
export async function serveMcp(message: McpMessage, endpoint: McpEndpoint): Promise<McpReply | null> {
  const { id, method, params } = message ?? {};
  const reply = (result: unknown): McpReply | null => (id === undefined ? null : { jsonrpc: '2.0', id, result });
  const fail = (code: number, text: string): McpReply | null => (id === undefined ? null : mcpError(code, text, id));
  switch (method) {
    case 'initialize': {
      const apps = endpoint.apps(method, params?.capabilities);
      return reply({
        protocolVersion: negotiateProtocol(params?.protocolVersion),
        capabilities: { tools: { listChanged: false }, ...(apps && endpoint.resources ? { resources: {} } : {}) },
        serverInfo: { name: 'open-artifact', version: endpoint.version },
        instructions: endpoint.instructions(apps),
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: endpoint.tools(endpoint.apps(method, undefined)) });
    case 'resources/list':
      return reply({ resources: endpoint.resources?.list() ?? [] });
    case 'resources/templates/list':
      return reply({ resourceTemplates: [] });
    case 'resources/read': {
      const contents = typeof params?.uri === 'string' ? (endpoint.resources?.read(params.uri) ?? null) : null;
      if (!contents) return fail(RPC_ERRORS.invalidParams, `No resource ${String(params?.uri)}.`);
      return reply({ contents: [contents] });
    }
    case 'tools/call': {
      const name = String(params?.name ?? '');
      const result = await endpoint.call(name, params?.arguments ?? {}, params?._meta ?? {});
      return reply(toolCallContent(result, !!endpoint.structured?.(name)));
    }
    default:
      if (id === undefined) return null;
      return fail(RPC_ERRORS.methodNotFound, `Method not found: ${method}`);
  }
}

/** The artifact card's resource (MCP Apps). */
export const CARD_URI = 'ui://open-artifact/card.html';
/** MCP Apps' HTML resource type. */
export const CARD_MIME = 'text/html;profile=mcp-app';

/** `ShowArtifact`: a card in the conversation with an Open button and a button that sends the comments back. */
export function showArtifactTool(agent: string): Record<string, unknown> {
  return {
    name: 'ShowArtifact',
    title: 'Show artifact',
    description: `Show an Open Artifact as a card in the conversation, with an Open button for its page and a button that sends the comments people left on it back to ${agent}. Call it once an artifact is filled and checked.`,
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The artifact: open-artifact://artifact/<id>.' } },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: {
      ui: { resourceUri: CARD_URI },
      'openai/outputTemplate': CARD_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Showing the artifact…',
      'openai/toolInvocation/invoked': 'Artifact shown',
    },
  };
}

/** The card resource's `resources/list` entry. */
export const CARD_LISTING = { uri: CARD_URI, name: 'open-artifact-card', title: 'Open Artifact card', mimeType: CARD_MIME };

/** The card resource's `resources/read` contents; `agent` names who the comments go to. */
export function cardContents(agent: string): Record<string, unknown> {
  return {
    uri: CARD_URI,
    mimeType: CARD_MIME,
    text: artifactCardHtml(agent),
    _meta: {
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      'openai/widgetPrefersBorder': true,
      'openai/widgetDescription': `An Open Artifact: its title and type, an Open button for its page, and a button that sends its comments to ${agent}.`,
      'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
    },
  };
}

const htmlText = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The card: ChatGPT's `window.openai` when it is there, else the MCP Apps messages (`ui/initialize`,
 * `ui/notifications/tool-result`, `ui/message`, `ui/open-link`). It frames nothing, so it needs no origin.
 */
export function artifactCardHtml(agent: string): string {
  const name = htmlText(agent);
  const js = JSON.stringify(agent).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e8;--accent:#2f5bb7;--accent-fg:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#1f1f22;--fg:#f2f2f4;--muted:#a0a0a8;--line:#36363b;--accent:#7f9fe6;--accent-fg:#111}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{display:flex;gap:14px;align-items:center;padding:14px 16px;flex-wrap:wrap}
.icon{width:40px;height:40px;flex:none}
.text{flex:1;min-width:160px}.title{font-weight:600;font-size:15px;overflow-wrap:anywhere}.meta{color:var(--muted);font-size:12.5px;margin-top:2px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
button{font:inherit;font-weight:550;border-radius:8px;padding:7px 12px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--fg)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
button:disabled{opacity:.55;cursor:default}
.hint{color:var(--muted);font-size:12.5px;padding:0 16px 12px}
</style></head><body>
<div class="card">
<svg class="icon" viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="8" width="30" height="30" rx="6" fill="#2f5bb7"/><rect x="26" y="26" width="30" height="30" rx="6" fill="#6f8fd4" stroke="#fff" stroke-width="3"/><circle cx="41" cy="41" r="6" fill="#fff"/></svg>
<div class="text"><div class="title" id="title">Open Artifact</div><div class="meta" id="meta">Loading…</div></div>
<div class="actions"><button id="open" disabled>Open</button><button id="send" class="primary" disabled>Send comments to ${name}</button></div>
</div>
<div class="hint" id="hint">Comment on the page, then press “Send comments to ${name}”.</div>
<script>
(function(){
  var agent=${js}, data=null, nextId=1, pending={};
  var oa=window.openai;
  function rpc(method,params){var id=nextId++;window.parent.postMessage({jsonrpc:'2.0',id:id,method:method,params:params||{}},'*');return new Promise(function(r){pending[id]=r;});}
  function notify(method,params){window.parent.postMessage({jsonrpc:'2.0',method:method,params:params||{}},'*');}
  function show(d){
    if(!d||!d.url)return; data=d;
    document.getElementById('title').textContent=d.title||'Untitled artifact';
    document.getElementById('meta').textContent=(d.type?d.type+' · ':'')+(d.view_url||d.url);
    document.getElementById('open').disabled=!d.view_url;
    document.getElementById('send').disabled=false;
  }
  window.addEventListener('message',function(e){
    var m=e.data; if(!m||m.jsonrpc!=='2.0')return;
    if(m.id!=null&&pending[m.id]){pending[m.id](m.result);delete pending[m.id];return;}
    if(m.method==='ui/notifications/tool-result'&&m.params)show(m.params.structuredContent);
  });
  window.addEventListener('openai:set_globals',function(){if(window.openai)show(window.openai.toolOutput);});
  if(oa){show(oa.toolOutput);}else{rpc('ui/initialize',{appInfo:{name:'open-artifact-card',version:'1'},appCapabilities:{},protocolVersion:'2025-11-21'}).then(function(){notify('ui/notifications/initialized');});}
  document.getElementById('open').onclick=function(){
    if(!data||!data.view_url)return;
    if(window.openai&&window.openai.openExternal)window.openai.openExternal({href:data.view_url});
    else if(!window.openai)rpc('ui/open-link',{url:data.view_url});
    else window.open(data.view_url,'_blank','noopener');
  };
  document.getElementById('send').onclick=function(){
    if(!data)return;
    var text='[Artifact comments sent to '+agent+'] Read the comments and requests on the artifact "'+(data.title||data.url)+'" ('+data.url+') with ArtifactComments {action: "read", url: "'+data.url+'"}, handle them, and reply to each.';
    var b=document.getElementById('send'), label=b.textContent; b.disabled=true; b.textContent='Sent';
    if(window.openai&&window.openai.sendFollowUpMessage)window.openai.sendFollowUpMessage({prompt:text});
    else rpc('ui/message',{role:'user',content:[{type:'text',text:text}]});
    setTimeout(function(){b.disabled=false;b.textContent=label;},4000);
  };
})();
</script></body></html>`;
}
