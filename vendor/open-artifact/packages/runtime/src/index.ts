/**
 * `@open-artifact/runtime`: the `window.openartifact` page runtime.
 *
 * - `capabilities.ts`: the capability contracts (types and errors).
 * - `client.ts`: installs `window.openartifact` over a provider.
 * - `local-provider.ts`: the provider backed by the local type server.
 * - `broker.ts`: the provider that brokers calls through the Shell (and `createPageProvider`).
 * - `http-api.ts`: the HTTP contract shared with `@open-artifact/type-server`.
 * - `sheet-api.ts`: the `sheet` capability's own routes and frames.
 * - `doc-api.ts`: the Docs type's HTTP contract (the `doc` capability).
 * - `shell.ts`: the page side of the Open Artifact Shell protocol.
 * - `untrusted.ts`: fencing untrusted text before it reaches a model.
 */
export * from './capabilities.ts';
export * from './client.ts';
export * from './local-provider.ts';
export * from './broker.ts';
export * from './http-api.ts';
export * from './sheet-api.ts';
export * from './doc-api.ts';
export * from './shell.ts';
export * from './untrusted.ts';
