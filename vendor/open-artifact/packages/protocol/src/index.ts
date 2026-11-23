/**
 * `@open-artifact/protocol`: the typed contracts of Open Artifact.
 *
 * - `refs.ts`: artifact / type URLs and Session Refs.
 * - `manifest.ts`: `artifact-type.json`.
 * - `library.ts`: the daemon's records and the Library API (`/api/open-artifact.*`).
 * - `harness.ts`: the Harness API (`/__harness`, JSON-RPC) and polling API.
 * - `type-server.ts`: `entry.start`, `/__open-artifact/*` and the Type API.
 * - `wake.ts`: wake messages from pages to agent sessions.
 * - `link.ts`: the Link API between a daemon and a cloud host (`/api/open-artifact.link.*`).
 * - `archive-paths.ts`: which paths of an artifact folder an export zip and a Link sync carry.
 * - `shell.ts`: the Shell's chrome and host `postMessage` protocols.
 * - `tools.ts`: the agent tools' schemas.
 * - `prompt.ts`: the agent's system prompt.
 * - `settings.ts`: `settings.json`.
 * - `mcp.ts`: MCP versions, messages and one message's answer, shared by the daemon's and the host's `/mcp`.
 * - `network.ts`: which host names plain `http` is allowed for (this computer, a private network).
 * - `title-from.ts`: reading a type's `titleFrom` (where an artifact's title lives in its files).
 * - `errors.ts`: errors on the wire.
 *
 * Everything here is platform neutral: no Node or DOM APIs.
 */
export * from './refs.ts';
export * from './errors.ts';
export * from './manifest.ts';
export * from './library.ts';
export * from './harness.ts';
export * from './type-server.ts';
export * from './wake.ts';
export * from './link.ts';
export * from './archive-paths.ts';
export * from './shell.ts';
export * from './tools.ts';
export * from './prompt.ts';
export * from './settings.ts';
export * from './mcp.ts';
export * from './network.ts';
export * from './title-from.ts';
