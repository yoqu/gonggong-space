import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSourceDeck, readSourceSlide } from '../src/index.ts';
import { parseStylesheet } from '../src/css/sheet.ts';

const CSS = `
@property --n { syntax: '<integer>'; inherits: false; initial-value: 0 }
@keyframes count { from { --n: 0 } }
@keyframes rise { from { opacity: 0; transform: translateY(20px) } to { opacity: 1 } }
@keyframes bad { from { background: url(https://example.com/x.png) } }
@media (prefers-reduced-motion: no-preference) {
  .n { animation: count 1.2s ease-out both }
}
.card { --i: 2; transition: opacity 400ms ease-out, transform 400ms; transition-delay: calc(var(--i) * 80ms); }
@starting-style { .card { opacity: 0; transform: translateY(1em) } }
.fragment { opacity: 0 }
.fragment.visible { opacity: 1 }
`;

describe('source deck motion', () => {
  it('keeps keyframes and registered properties, but not rules that load anything', () => {
    const sheet = parseStylesheet(CSS, { width: 1920, height: 1080 });
    assert.equal(sheet.motion.length, 3);
    assert.ok(sheet.motion[0]!.startsWith('@property --n'));
    assert.ok(!sheet.motion.some((rule) => rule.includes('url(')));
    assert.deepEqual(sheet.keyframes, ['count', 'rise', 'bad']);
    assert.equal(sheet.starting.length, 1);
    // @starting-style rules never style the still slide.
    assert.equal(sheet.rules.filter((r) => r.declarations.some((d) => d.name === 'transform')).length, 0);
  });

  it('reads animations, transitions, starting styles and in-flow fragments by origin', () => {
    const deck = createSourceDeck(CSS);
    const html = `<section id="s1"><p class="n">93%</p><div class="card"><p>A</p></div><p class="fragment" data-fragment-index="1">Later</p><p class="fragment">Last</p></section>`;
    const read = readSourceSlide(html, deck, { id: 's1', lints: false });
    assert.equal(read.held, false);
    const motion = read.slide.motion!;
    assert.ok(motion);
    assert.equal(motion.elements[1]!.animation, 'count 1.2s ease-out both');
    assert.equal(motion.elements[2]!['transition-delay'], 'calc(2 * 80ms)');
    assert.deepEqual(motion.starting[2], { opacity: '0', transform: 'translateY(32px)' }); // 1em at the body's 32px
    assert.deepEqual(motion.fragments, [{ origin: 4, index: 1 }, { origin: 5 }]);
    // The still slide shows fragments, and carries no motion in its style.
    assert.ok(!read.diagnostics.some((d) => /fragment/.test(d.message)));
    assert.ok(!read.flat.includes('animation'));
  });

  it('leaves slides without motion alone', () => {
    const read = readSourceSlide('<section id="s2"><p>Still</p></section>', createSourceDeck('p { color: red }'), { id: 's2', lints: false });
    assert.equal(read.slide.motion, undefined);
  });
});
