import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ShellConnection } from '@open-artifact/runtime';
import { canWriteClipboard, clipboardRefused, writeClipboard, writeClipboardText } from '../src/clipboard.ts';

const refusal = (): Error => Object.assign(new Error('Write permission denied.'), { name: 'NotAllowedError' });

/** The browser's clipboard: `refuse` makes it act like a framed page the browser keeps out. */
function installBrowser(behaviour: { refuse?: boolean; fail?: Error } | null) {
  const writes: unknown[] = [];
  const texts: string[] = [];
  const clipboard = behaviour && {
    async write(items: unknown[]) {
      if (behaviour.fail) throw behaviour.fail;
      if (behaviour.refuse) throw refusal();
      writes.push(...items);
    },
    async writeText(text: string) {
      if (behaviour.refuse) throw refusal();
      texts.push(text);
    },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
  if (behaviour) Object.defineProperty(globalThis, 'ClipboardItem', { value: class { items: unknown; constructor(items: unknown) { this.items = items; } }, configurable: true });
  else delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
  return { writes, texts };
}

/** A Shell that writes the clipboard (or does not, like an older one). */
function shell(writesClipboard = true) {
  const relayed: Array<Record<string, Blob>> = [];
  const connection = {
    writesClipboard,
    async writeClipboard(items: Record<string, Blob | PromiseLike<Blob>>) {
      const read: Record<string, Blob> = {};
      for (const [type, blob] of Object.entries(items)) read[type] = await blob;
      relayed.push(read);
    },
  } as unknown as ShellConnection;
  return { connection, relayed };
}

const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const savedItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
beforeEach(() => installBrowser(null));
afterEach(() => {
  if (saved) Object.defineProperty(globalThis, 'navigator', saved);
  if (savedItem) Object.defineProperty(globalThis, 'ClipboardItem', savedItem);
  else delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
});

describe('writeClipboard', () => {
  it('writes through the browser where it lets the page', async () => {
    const browser = installBrowser({});
    const { connection, relayed } = shell();
    await writeClipboard({ 'image/png': Promise.resolve(new Blob(['png'], { type: 'image/png' })) }, connection);
    assert.equal(browser.writes.length, 1);
    assert.equal(relayed.length, 0);
  });

  it('has the Shell write when the browser refuses the framed page, image still drawing', async () => {
    installBrowser({ refuse: true });
    const { connection, relayed } = shell();
    let draw!: (blob: Blob) => void;
    const png = new Promise<Blob>((resolve) => (draw = resolve));
    const done = writeClipboard({ 'image/png': png }, connection);
    setTimeout(() => draw(new Blob(['png'], { type: 'image/png' })), 5);
    await done;
    assert.equal(relayed.length, 1);
    assert.equal(await relayed[0]!['image/png']!.text(), 'png');
  });

  it('passes on a refusal when no Shell writes, and any other failure as it is', async () => {
    installBrowser({ refuse: true });
    await assert.rejects(writeClipboard({ 'text/plain': new Blob(['x']) }, null), (error: unknown) => clipboardRefused(error));
    await assert.rejects(writeClipboard({ 'text/plain': new Blob(['x']) }, shell(false).connection), (error: unknown) => clipboardRefused(error));
    installBrowser({ fail: new Error('The element is empty.') });
    const { connection, relayed } = shell();
    await assert.rejects(writeClipboard({ 'text/plain': new Blob(['x']) }, connection), /The element is empty/);
    assert.equal(relayed.length, 0, 'a failure of the content is no reason to ask the Shell');
  });

  it('goes to the Shell where the browser has no clipboard formats at all', async () => {
    const { connection, relayed } = shell();
    assert.equal(canWriteClipboard(null), false);
    assert.equal(canWriteClipboard(connection), true);
    await writeClipboard({ 'text/plain': new Blob(['x']) }, connection);
    assert.equal(relayed.length, 1);
    await assert.rejects(writeClipboard({ 'text/plain': new Blob(['x']) }, null), /cannot copy/);
  });

  it('writeClipboardText: the browser first, else the Shell as plain text', async () => {
    const browser = installBrowser({});
    await writeClipboardText('hello', shell().connection);
    assert.deepEqual(browser.texts, ['hello']);
    installBrowser({ refuse: true });
    const { connection, relayed } = shell();
    await writeClipboardText('framed', connection);
    assert.equal(await relayed[0]!['text/plain']!.text(), 'framed');
    await assert.rejects(writeClipboardText('nobody', null), (error: unknown) => clipboardRefused(error));
  });
});
