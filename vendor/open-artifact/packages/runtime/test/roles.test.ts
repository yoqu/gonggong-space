/** The role table a type server and a cloud host share. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOC_API } from '../src/doc-api.ts';
import { API } from '../src/http-api.ts';
import { ASK_AGENT_ROUTES, isOwnerOnlyRoute, roleMay } from '../src/roles.ts';
import { SHEET_API } from '../src/sheet-api.ts';

describe('roleMay', () => {
  it('lets the owner do anything', () => {
    assert.equal(roleMay('owner', API.agentSend), true);
    assert.equal(roleMay('owner', '_api/something-new'), true);
  });
  it('keeps owner routes to the owner', () => {
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      assert.equal(roleMay(role, API.agentSend), false);
      assert.equal(roleMay(role, API.downloads), false);
      assert.equal(roleMay(role, SHEET_API.importFile), false);
    }
  });
  it('lets everyone make posted reads and presence', () => {
    assert.equal(roleMay('viewer', API.presence), true);
    assert.equal(roleMay('viewer', DOC_API.read), true);
    assert.equal(roleMay('viewer', SHEET_API.read), true);
  });
  it('lets commenters comment and editors edit', () => {
    assert.equal(roleMay('commenter', API.commentsCreate), true);
    assert.equal(roleMay('viewer', API.commentsCreate), false);
    assert.equal(roleMay('commenter', API.publish), false);
    assert.equal(roleMay('editor', API.publish), true);
    assert.equal(roleMay('editor', DOC_API.restore), true);
  });
  it('lets a commenter write the db only when the type allows it', () => {
    assert.equal(roleMay('commenter', API.dbWrite), false);
    assert.equal(roleMay('commenter', API.dbWrite, { commenterWrites: true }), true);
    assert.equal(roleMay('viewer', API.dbWrite, { commenterWrites: true }), false);
  });
  it('treats an unknown route as the owner’s', () => {
    assert.equal(roleMay('editor', '_api/something-new'), false);
  });
});

describe('editorsAskAgent', () => {
  it('lets an editor send to the agent only when on, and never a commenter or viewer', () => {
    assert.deepEqual([...ASK_AGENT_ROUTES].sort(), [API.agentSend, API.commentsSend, API.dataRefresh].sort());
    for (const route of ASK_AGENT_ROUTES) {
      assert.equal(roleMay('editor', route), false, route);
      assert.equal(roleMay('editor', route, { editorsAskAgent: false }), false, route);
      assert.equal(roleMay('editor', route, { editorsAskAgent: true }), true, route);
      assert.equal(roleMay('commenter', route, { editorsAskAgent: true }), false, route);
      assert.equal(roleMay('viewer', route, { editorsAskAgent: true }), false, route);
      assert.equal(roleMay('owner', route), true, route);
    }
    // The other owner-only routes stay the owner's.
    for (const route of [API.mcpCall, API.downloads, SHEET_API.importFile]) assert.equal(roleMay('editor', route, { editorsAskAgent: true }), false, route);
  });
});

describe('isOwnerOnlyRoute', () => {
  it('names the routes only the owner may call', () => {
    assert.equal(isOwnerOnlyRoute(API.mcpCall), true);
    assert.equal(isOwnerOnlyRoute(API.commentsSend), true);
    assert.equal(isOwnerOnlyRoute(API.publish), false);
    assert.equal(isOwnerOnlyRoute('_api/something-new'), false);
  });
});

describe('roles.ts', () => {
  it('stays pure: no Node or DOM imports', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/roles.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ['./capabilities.ts', './doc-api.ts', './http-api.ts', './sheet-api.ts']);
  });
});
