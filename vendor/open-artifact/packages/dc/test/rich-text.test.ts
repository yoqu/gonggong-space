import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  elementAtPath,
  hasBlockContent,
  hasTextHoles,
  importTextOutcome,
  importTextTargets,
  isTextEditable,
  looseTextRuns,
  parseTemplate,
  quoteScriptString,
  sanitizeTextHtml,
  scriptLiterals,
} from '../src/index.ts';

const first = (template: string, path: number[] = [0]) => elementAtPath(parseTemplate(template), path)!;

describe('isTextEditable (rich text)', () => {
  it('takes words with inline formatting', () => {
    assert.equal(isTextEditable(first('<p>Read <b>more</b> and <a href="/x">this</a><br>now</p>')), true);
    assert.equal(isTextEditable(first('<h1>Plain</h1>')), true);
    assert.equal(isTextEditable(first('<p>Hello {{name}}</p>')), true);
    assert.equal(hasTextHoles(first('<p>Hello <b>{{name}}</b></p>')), true);
    assert.equal(hasTextHoles(first('<p>Hello</p>')), false);
  });

  it('refuses layout, code and drawings', () => {
    assert.equal(isTextEditable(first('<div><p>One</p><p>Two</p></div>')), false);
    assert.equal(isTextEditable(first('<p>Text <img src="a.png"></p>')), false);
    assert.equal(isTextEditable(first('<ul><li>One</li></ul>')), false);
    assert.equal(isTextEditable(first('<sc-for each="{{items}}"><p>x</p></sc-for>')), false);
    assert.equal(isTextEditable(first('<svg><g><rect/></g></svg>', [0, 0])), false);
    assert.equal(isTextEditable(first('<style>p{}</style>')), false);
    // A link laid out as a box is not words in the flow.
    assert.equal(isTextEditable(first('<p>Go <a href="/" style="display: block">here</a></p>')), false);
    assert.equal(isTextEditable(first('<p>Go <a href="/" style="display: inline-block">here</a></p>')), true);
  });

  it('edits the label of an icon-and-label wrapper, not the wrapper', () => {
    assert.equal(isTextEditable(first('<button><span class="icon"></span><span>Save</span></button>')), false);
    assert.equal(isTextEditable(first('<button><span class="icon"></span><span>Save</span></button>', [0, 1])), true);
    assert.equal(isTextEditable(first('<button>Save <span class="icon"></span></button>')), true);
  });

  it('lets an empty text element be filled', () => {
    assert.equal(isTextEditable(first('<p></p>')), true);
    assert.equal(isTextEditable(first('<div></div>')), false);
  });
});

describe('SVG text', () => {
  it('edits drawn words that are only words', () => {
    assert.equal(isTextEditable(first('<svg><text x="0">Hi there</text></svg>', [0, 0])), true);
    assert.equal(isTextEditable(first('<svg><text><tspan>Hi</tspan></text></svg>', [0, 0, 0])), true);
    assert.equal(isTextEditable(first('<svg><text><tspan>Hi</tspan></text></svg>', [0, 0])), false);
    assert.equal(isTextEditable(first('<svg><text></text></svg>', [0, 0])), false);
  });
});

describe('looseTextRuns', () => {
  it('finds runs of words between other layout, trimmed', () => {
    const template = '<div> Hi <b>you</b> <img src="a"> two <sc-if value="{{x}}">three</sc-if></div>';
    const runs = looseTextRuns(first(template), template, true).map((run) => template.slice(run.start, run.end));
    assert.deepEqual(runs, ['Hi <b>you</b>', 'two', 'three']);
    assert.deepEqual(looseTextRuns(first('<svg>x</svg>'), '<svg>x</svg>', true), []);
  });
});

describe('words of a component instance', () => {
  it('names the words written on an instance', () => {
    const element = first('<x-import component="Card" from="./c.dc.html" title="Hello" class="big" n="{{ 4 }}" flag="true">Body</x-import>');
    assert.deepEqual(importTextTargets(element, null), [
      { words: 'Body', key: '__text' },
      { words: 'Hello', key: '@title' },
      { words: '4', key: '@n', number: true },
    ]);
  });

  it('leaves out words written twice, mixed attributes and words a hole may supply', () => {
    assert.deepEqual(importTextTargets(first('<x-import component="C" a="Same" b="Same"></x-import>'), null), []);
    assert.deepEqual(importTextTargets(first('<x-import component="C" a="Hi {{name}}" b="x"></x-import>'), null), []);
    const dynamic = first('<x-import component="C" a="{{name}}" b="Known" c="Fresh words"></x-import>');
    assert.deepEqual(importTextTargets(dynamic, null), []);
    assert.deepEqual(importTextTargets(dynamic, new Set(['Known'])), [{ words: 'Fresh words', key: '@c' }]);
    assert.deepEqual(importTextTargets(first('<sc-for each="{{xs}}"><x-import component="C" a="Hi"></x-import></sc-for>', [0, 0]), null), []);
  });

  it('checks retyped words', () => {
    const targets = [{ words: 'Hello', key: '@title' }, { words: '4', key: '@n', number: true }];
    assert.deepEqual(importTextOutcome({ key: '@title', words: 'Hello' }, ' Hi\n there ', targets), { kind: 'commit', key: '@title', text: 'Hi there' });
    assert.deepEqual(importTextOutcome({ key: '@title', words: 'Hello' }, 'Hello', targets), { kind: 'noop' });
    assert.deepEqual(importTextOutcome({ key: '@n', words: '4' }, '5.5', targets), { kind: 'commit', key: '@n', text: '{{ 5.5 }}' });
    assert.deepEqual(importTextOutcome({ key: '@n', words: '4' }, 'five', targets), { kind: 'notnumber' });
    assert.deepEqual(importTextOutcome({ key: '@x', words: 'Hello' }, 'Hi', targets), { kind: 'refuse' });
  });
});

describe('sanitizeTextHtml', () => {
  it('keeps words and formatting', () => {
    assert.equal(sanitizeTextHtml('Read <b>more</b> &amp; <a href="https://x.dev/?a=1&amp;b=2">this</a><br>now'), 'Read <b>more</b> &amp; <a href="https://x.dev/?a=1&amp;b=2">this</a><br>now');
    assert.equal(sanitizeTextHtml('a&nbsp;b &lt;tag&gt;'), 'a&nbsp;b &lt;tag&gt;');
    assert.equal(sanitizeTextHtml('Hi {{name}}'), 'Hi {{name}}');
  });

  it('drops scripts, handlers, code-running links and the editor’s marks', () => {
    assert.equal(sanitizeTextHtml('a<script>alert(1)</script><!-- x -->b'), 'ab');
    assert.equal(sanitizeTextHtml('<b onclick="x()" data-dc-tpl="3" contenteditable="true">x</b>'), '<b>x</b>');
    assert.equal(sanitizeTextHtml('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
    assert.equal(sanitizeTextHtml('<a href=" JaVaScRiPt:alert(1)">x</a>'), '<a>x</a>');
    assert.equal(sanitizeTextHtml('<iframe src="/"></iframe>x'), 'x');
    assert.equal(sanitizeTextHtml('<span style="color: red">x</span>'), '<span style="color: red">x</span>');
  });

  it('drops the caret’s trailing break', () => {
    assert.equal(sanitizeTextHtml('One<br>Two<br>'), 'One<br>Two');
    assert.equal(sanitizeTextHtml('One<br><br>'), 'One<br><br>');
    assert.equal(sanitizeTextHtml('<br>'), '<br>');
  });

  it('notices block content', () => {
    assert.equal(hasBlockContent('<ul><li>a</li></ul>'), true);
    assert.equal(hasBlockContent('<b>a</b><br>'), false);
  });
});

describe('script literals', () => {
  it('finds string literals, skipping comments, regexes and dynamic templates', () => {
    const js = `// 'not this'\nconst a = "Hello \\"you\\"";\n/* "nor this" */ const r = /'x'/g; const b = 'It\\'s'; const c = \`plain\`; const d = \`\${a} dyn\`; const e = x / 2 / 'z'.length;`;
    const found = scriptLiterals(js).map((literal) => [literal.quote, literal.value, js.slice(literal.start, literal.end)]);
    assert.deepEqual(found, [
      ['"', 'Hello "you"', '"Hello \\"you\\""'],
      ["'", "It's", "'It\\'s'"],
      ['`', 'plain', '`plain`'],
      ["'", 'z', "'z'"],
    ]);
  });

  it('writes text back as a literal that reads the same', () => {
    for (const [text, quote] of [['It\'s "new"\nline', "'"], ['a`b${c}', '`'], ['</script>', '"']] as const) {
      const literal = quoteScriptString(text, quote);
      assert.equal(scriptLiterals(`x = ${literal};`)[0]!.value, text);
      assert.doesNotMatch(literal, /<\/script/i);
    }
  });
});
