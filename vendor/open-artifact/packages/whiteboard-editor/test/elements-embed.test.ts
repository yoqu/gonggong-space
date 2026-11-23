import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_HTML_STATE_CHARS } from '@open-artifact/whiteboard-core';
import {
  EMBED_CSP,
  EMBED_OWN_WRITES,
  buildEmbedSrcdoc,
  createFloodGuard,
  createStateSaver,
  embedBootstrap,
  embedRefusal,
  isEmbedSaveMessage,
  type SaverClock,
} from '../src/elements/embed.ts';
import { artifactIdOf, boardLinkTarget, linkDisplayUrl, resolveAssetUrl } from '../src/elements/links.ts';

/** A clock whose timers run only when told to. */
function manualClock(): SaverClock & { run(): void } {
  let queued: (() => void) | undefined;
  return {
    setTimeout(callback) {
      queued = callback;
      return 1;
    },
    clearTimeout() {
      queued = undefined;
    },
    run() {
      const callback = queued;
      queued = undefined;
      callback?.();
    },
  };
}

describe('embed sandbox', () => {
  it('builds a srcdoc with the policy first and the page doctype removed', () => {
    const doc = buildEmbedSrcdoc('<!DOCTYPE html><title>Hi</title><p>x</p>', '{"n":1}');
    assert.ok(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
    assert.ok(doc.includes("connect-src 'none'"));
    assert.equal(doc.match(/<!doctype/gi)?.length, 1);
    assert.ok(doc.endsWith('<title>Hi</title><p>x</p>'));
    assert.ok(EMBED_CSP.startsWith("default-src 'none'"));
  });

  it('escapes the initial state so it cannot close the script', () => {
    const boot = embedBootstrap('{"html":"</script><script>alert(1)</script>"}');
    assert.ok(!boot.includes('</script>'));
    assert.ok(boot.includes('\\u003c/script>'));
  });

  it('refuses nested frames, plugins and linked files', () => {
    assert.equal(embedRefusal('<p>ok</p><script>1</script>'), undefined);
    for (const html of ['<iframe src=x>', '<OBJECT>', '<link rel=stylesheet href=x>', '<template shadowrootmode="open">', '< embed>'])
      assert.ok(embedRefusal(html), html);
  });

  it('recognizes save messages', () => {
    assert.ok(isEmbedSaveMessage({ boardEmbed: 'save', state: '{}' }));
    assert.ok(!isEmbedSaveMessage({ boardEmbed: 'save', state: 1 }));
    assert.ok(!isEmbedSaveMessage(null));
  });
});

describe('createStateSaver', () => {
  it('writes the first save at once and debounces the rest', () => {
    const writes: string[] = [];
    const clock = manualClock();
    const saver = createStateSaver((state) => writes.push(state), 400, clock);
    saver.save('1');
    saver.save('2');
    saver.save('3');
    assert.deepEqual(writes, ['1']);
    clock.run();
    assert.deepEqual(writes, ['1', '3']);
    assert.ok(saver.isOwnWrite('3'));
    assert.ok(!saver.isOwnWrite('2'));
  });

  it('remembers only its last writes, drops oversized states and flushes on demand', () => {
    const writes: string[] = [];
    const saver = createStateSaver((state) => writes.push(state), 400, manualClock());
    saver.save('x'.repeat(MAX_HTML_STATE_CHARS + 1));
    assert.deepEqual(writes, []);
    saver.save('a');
    for (let index = 0; index < EMBED_OWN_WRITES; index += 1) {
      saver.save(`b${index}`);
      saver.flush();
    }
    assert.ok(!saver.isOwnWrite('a'));
    assert.ok(saver.isOwnWrite(`b${EMBED_OWN_WRITES - 1}`));
  });
});

describe('createFloodGuard', () => {
  it('trips after too many messages in a second', () => {
    const guard = createFloodGuard(3, 1000);
    assert.deepEqual([guard.hit(0), guard.hit(1), guard.hit(2), guard.hit(3)], [false, false, false, true]);
    assert.equal(guard.hit(1500), false);
  });
});

describe('board links', () => {
  it('opens artifacts in the Shell and web links as they are', () => {
    assert.equal(artifactIdOf('open-artifact://artifact/art_abc1234567'), 'art_abc1234567');
    assert.equal(artifactIdOf('https://example.com'), undefined);
    assert.equal(boardLinkTarget('open-artifact://artifact/art_abc1234567', 'https://shell.test'), 'https://shell.test/a/art_abc1234567');
    assert.equal(boardLinkTarget('https://example.com/x'), 'https://example.com/x');
    assert.equal(boardLinkTarget('javascript:alert(1)'), undefined);
  });

  it('shows short addresses and resolves uploads relative to the page', () => {
    assert.equal(linkDisplayUrl('https://example.com/'), 'example.com');
    assert.equal(linkDisplayUrl('https://example.com/a/b'), 'example.com/a/b');
    assert.equal(resolveAssetUrl(`/_blob/${'0f'.repeat(16)}`), `/_blob/${'0f'.repeat(16)}`);
    assert.equal(resolveAssetUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  });
});
