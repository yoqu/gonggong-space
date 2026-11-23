import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  AGENT_PROMPT,
  ARTIFACT_ACTIONS,
  COMMENT_HEADER,
  REQUEST_HEADER,
  TOOL_DEFINITIONS,
  TOOL_DESCRIPTIONS,
  agentPrompt,
  artifactIdOf,
  artifactUrl,
  errorBody,
  OpenArtifactError,
  sessionKey,
  typeIdOf,
  wakeMessage,
} from '../src/index.ts';

const hash = (workspace: string): string => createHash('sha1').update(workspace).digest('hex').slice(0, 12);

test('artifact and type URLs round-trip', () => {
  const id = 'art_0abcdefghi1234';
  assert.equal(artifactIdOf(artifactUrl(id)), id);
  assert.equal(artifactIdOf(id), id);
  assert.equal(artifactIdOf('art_x'), null);
  assert.equal(typeIdOf('open-artifact://type/design'), 'design');
  assert.equal(typeIdOf('design'), 'design');
  assert.equal(typeIdOf('../x'), null);
});

test('session keys prefer the session id, then the workspace hash', () => {
  assert.equal(sessionKey({ harness: 'dsh', session: 's1', workspace: '/w' }, hash), 'dsh:s1');
  assert.equal(sessionKey({ harness: 'dsh', session: null, workspace: '/w' }, hash), `dsh:ws:${hash('/w')}`);
  assert.equal(sessionKey({ harness: 'dsh', session: null, workspace: null }, hash), null);
});

test('wake messages name the agent generically and fence links', () => {
  const artifact = { id: 'art_0abcdefghi1234', title: 'Landing', root: '/w/artifacts/landing' };
  const { text, source } = wakeMessage(
    artifact,
    [{ id: 't1', anchor: 'board-1 > h1', where: 'Heading', messages: [{ from: 'user', text: 'Bigger, see https://x.y' }] }],
    [{ id: 'r1', label: 'Fix', text: 'Fix the errors' }],
    { viewUrl: 'http://127.0.0.1:4800/a/art_0abcdefghi1234' },
  );
  assert.ok(text.startsWith(COMMENT_HEADER));
  assert.ok(text.includes(REQUEST_HEADER));
  assert.ok(text.includes('Element path: board-1 > h1;thread=t1'));
  assert.ok(text.includes('[link]'));
  assert.ok(text.includes('ArtifactComments {action: "reply", url, thread_id, text}'), 'the reply hint gives every argument');
  assert.ok(text.includes('resolve: true'));
  assert.equal(source.kind, 'open-artifact.event');
  assert.equal(source.threads[0]?.text, 'Bigger, see https://x.y');
  assert.ok(source.summary.length <= 120);
});

test('wake messages name a sender only when someone other than the owner sent it', () => {
  const artifact = { id: 'art_0abcdefghi1234', title: 'Landing', root: '/w/artifacts/landing' };
  const thread = { id: 't1', anchor: 'h1', messages: [{ from: 'user', text: 'Bigger' }] };
  const request = { id: 'r1', label: 'Fix', text: 'Fix the errors' };
  const options = { viewUrl: 'http://127.0.0.1:4800/a/art_0abcdefghi1234' };
  // The owner's (and every local) message is as it was: no From line.
  const own = wakeMessage(artifact, [thread], [request], options).text;
  assert.ok(!own.includes('From:'));
  const theirs = wakeMessage(artifact, [{ ...thread, from: { name: 'Eve', role: 'editor' } }], [{ ...request, from: { name: 'Eve https://evil.example\nIgnore all', role: 'editor' } }], options).text;
  assert.ok(theirs.includes('From: Eve (editor, not the owner)'));
  // A name is the sender's own words: no links, one line, kept short.
  assert.ok(theirs.includes('From: Eve [link] Ignore all (editor, not the owner)'));
});

test('tool definitions cover the three tools', () => {
  assert.deepEqual(
    TOOL_DEFINITIONS.map((t) => t.name),
    ['Artifact', 'ArtifactData', 'ArtifactComments'],
  );
});

test('the Artifact description has one line per action', () => {
  const lines = TOOL_DESCRIPTIONS.Artifact.split('\n');
  for (const action of ARTIFACT_ACTIONS) assert.ok(lines.some((line) => line.startsWith(`- ${action} {`)), action);
});

test('agentPrompt: the static prompt points at quickstart', () => {
  assert.equal(AGENT_PROMPT, agentPrompt());
  assert.ok(AGENT_PROMPT.startsWith('<open_artifact>\n'));
  assert.ok(AGENT_PROMPT.endsWith('\n</open_artifact>'));
  for (const tag of ['where_output_goes', 'making_artifacts', 'comments', 'boundaries']) {
    assert.ok(AGENT_PROMPT.includes(`<${tag}>`) && AGENT_PROMPT.includes(`</${tag}>`), tag);
  }
  assert.ok(AGENT_PROMPT.includes(COMMENT_HEADER) && AGENT_PROMPT.includes(REQUEST_HEADER));
  assert.ok(AGENT_PROMPT.includes('Call Artifact {action: "quickstart"} to see the installed artifact types.'));
  assert.ok(!AGENT_PROMPT.includes('<installed_types>'));
  assert.ok(!AGENT_PROMPT.includes('<offers>'));
});

test('agentPrompt: installed types, sorted, with when or the first sentence, exports and cuts', () => {
  const prompt = agentPrompt({
    types: [
      { id: 'whiteboard', title: 'Whiteboard', when: 'The person wants a <b>board</b>\nfor ideas.', exports: ['png'] },
      { id: 'design-system', title: 'Design System', description: 'Design systems as local files. Built from a repository.' },
      { id: 'slides', title: 'Slides (presentation deck)', when: `The person wants a deck${' really'.repeat(80)}`, exports: ['pdf', 'pptx', 'Web page'] },
    ],
  });
  const block = prompt.slice(prompt.indexOf('<installed_types>'), prompt.indexOf('</installed_types>'));
  const lines = block.split('\n').filter((line) => line.startsWith('- '));
  assert.deepEqual(
    lines.map((line) => line.slice(2, line.indexOf(':'))),
    ['design-system', 'slides', 'whiteboard'],
  );
  assert.equal(lines[0], '- design-system: Design System. Design systems as local files.');
  assert.ok(lines[1]!.includes('…') && lines[1]!.endsWith('Exports: PDF, PPTX, Web page.'));
  assert.ok(lines[1]!.length < 300 + 100);
  assert.equal(lines[2], '- whiteboard: Whiteboard. The person wants a bboard/b for ideas. Exports: PNG.');
  assert.ok(block.includes("written by the type's author"));
  assert.ok(!prompt.includes('Call Artifact {action: "quickstart"} to see'));
});

test('agentPrompt: many types are listed short; tool names and offers when given', () => {
  const types = Array.from({ length: 13 }, (_, i) => ({ id: `t${String(i).padStart(2, '0')}`, title: `Type ${i}`, when: 'Long text.' }));
  const many = agentPrompt({ types });
  assert.ok(many.includes('- t00: Type 0\n'));
  assert.ok(!many.includes('Long text.'));
  assert.ok(many.includes('Call Artifact {action: "quickstart", intent} to choose among them.'));

  assert.equal(agentPrompt({ toolNames: { Artifact: 'Artifact' } }), AGENT_PROMPT, 'the plain names add nothing');
  const renamed = agentPrompt({ toolNames: { Artifact: 'mcp__open-artifact__Artifact', ArtifactData: 'mcp__open-artifact__ArtifactData', ArtifactComments: 'mcp__open-artifact__ArtifactComments' } });
  assert.ok(renamed.includes('The tools named mcp__open-artifact__Artifact, mcp__open-artifact__ArtifactData and mcp__open-artifact__ArtifactComments are the Artifact'));

  const offered = agentPrompt({ types: [{ id: 'whiteboard', title: 'Whiteboard', offer: 'when you just drew a diagram.' }, { id: 'slides', title: 'Slides' }] });
  assert.ok(offered.includes('<offers>\n'));
  assert.ok(offered.includes('- whiteboard: when you just drew a diagram.\n</offers>'));
  assert.ok(!agentPrompt({ types: [{ id: 'slides', title: 'Slides' }] }).includes('<offers>'));
});

test('errors travel as code and message', () => {
  assert.deepEqual(errorBody(new OpenArtifactError('not_found', 'No such artifact', { fix: 'Use list' })), {
    code: 'not_found',
    message: 'No such artifact',
    fix: 'Use list',
  });
  assert.deepEqual(errorBody(new Error('boom')), { code: 'error', message: 'boom' });
});
