import assert from 'node:assert/strict';
import { test } from 'node:test';

/*
 * A class counts as an element's own only while no other scene's box has it, so each runner notes every scene's box
 * as it comes up. The editor's stage loads the film without the record of what a person did by hand to how things
 * look and is given it after; an export or a still loads it with the film. Both must note the boxes, or the same pair
 * is judged one way in the editor and another in what is made from it.
 */

// The runtime takes these as it is loaded; nothing here calls them.
Reflect.set(globalThis, 'MutationObserver', class {});
Reflect.set(globalThis, 'window', globalThis);
const { sceneBox } = await import('../src/runtime/load.ts');
const { addModules } = await import('../src/runtime/modules.ts');
const { boxes } = await import('../src/runtime/retouch/judge.ts');

/** A scene's box holding one element with these classes. */
const box = (...names: string[]): HTMLElement => ({ getElementsByTagName: () => [{ classList: names }] }) as unknown as HTMLElement;
const noted = (node: HTMLElement): string[] => [...(boxes.find((each) => each.node === node)?.names ?? [])];

test('a scene box is noted when the film came without the record, as on the editor’s stage', () => {
  addModules([{ name: 'base.css', kind: 'css', text: '.fish{}' }]);
  const node = box('fish', 'big');
  sceneBox(node);
  assert.deepEqual(noted(node), ['fish', 'big']);
});

test('a scene box is noted when the film came with the record, as in an export', () => {
  addModules([{ name: 'retouched.json', kind: 'json', text: '{"v":1,"layers":[]}' }]);
  const node = box('fish');
  sceneBox(node);
  assert.deepEqual(noted(node), ['fish']);
});
