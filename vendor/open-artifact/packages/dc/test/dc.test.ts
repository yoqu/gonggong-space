import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyEdits,
  checkDcFile,
  duplicateElements,
  elementAtPath,
  elementKind,
  elementLabel,
  elementPath,
  encodeBoardName,
  formatAddress,
  insertHtml,
  moveElements,
  parseAddress,
  parseDcDocument,
  parseHtml,
  parseTemplate,
  patchStyle,
  removeElements,
  replaceProps,
  replaceTemplate,
  resolveElement,
  serializeNodes,
  setAttribute,
  setStyle,
  setText,
  splitHoles,
  evaluateHole,
  interpolate,
  unwrapElement,
  wrapElements,
} from '../src/index.ts';

const MINIMAL = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; }
  </style>
</helmet>
<div style="padding: 32px">
  <h1>{{title}}</h1>
  <sc-for list="{{items}}" as="item" hint-placeholder-count="3">
    <div>{{item.label}}</div>
  </sc-for>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"title":{"editor":"text","default":"It&#39;s &amp; more"}}'>
class Component extends DCLogic {
  renderVals() {
    return { title: this.props.title ?? 'Hello', items: [{ label: 'One' }] };
  }
}
</script>
</body>
</html>
`;

describe('document', () => {
  it('finds the template, script and props', () => {
    const doc = parseDcDocument(MINIMAL);
    assert.ok(doc.template);
    assert.ok(doc.template.text.startsWith('\n<helmet>'));
    assert.equal(doc.title, 'Hello');
    assert.equal(doc.lang, 'en');
    assert.equal(doc.hasSupportScript, true);
    assert.deepEqual(doc.props, { title: { editor: 'text', default: "It's & more" } });
    assert.match(doc.script!.body.text, /class Component extends DCLogic/);
  });

  it('replaces props with the three escapes only', () => {
    const doc = parseDcDocument(MINIMAL);
    const next = replaceProps(doc, { title: { editor: 'text', default: `Tom's "café" & co — ok` } });
    assert.match(next, /data-props='\{"title":\{"editor":"text","default":"Tom&#39;s \\"café\\" &amp; co — ok"\}\}'/);
    assert.deepEqual(parseDcDocument(next).props, { title: { editor: 'text', default: `Tom's "café" & co — ok` } });
  });

  it('keeps every byte outside the template', () => {
    const doc = parseDcDocument(MINIMAL);
    const next = replaceTemplate(doc, '\n<p>x</p>\n');
    assert.equal(next.slice(0, doc.template!.start), MINIMAL.slice(0, doc.template!.start));
    assert.equal(next.slice(next.lastIndexOf('</x-dc>')), MINIMAL.slice(MINIMAL.lastIndexOf('</x-dc>')));
  });
});

describe('template addressing', () => {
  const model = parseTemplate(parseDcDocument(MINIMAL).template!.text);

  it('numbers elements and paths like the view-state reference', () => {
    const expected: [string, string][] = [
      ['helmet', '0'],
      ['style', '0/0'],
      ['div', '1'],
      ['h1', '1/0'],
      ['sc-for', '1/1'],
      ['div', '1/1/0'],
    ];
    assert.equal(model.elements.length, expected.length);
    expected.forEach(([tag, path], tid) => {
      const element = model.elements[tid]!;
      assert.equal(element.tag, tag);
      assert.equal(elementPath(model, element).join('/'), path);
      assert.equal(elementAtPath(model, path.split('/').map(Number)), element);
    });
  });

  it('formats and parses addresses', () => {
    assert.equal(formatAddress('Main.dc.html', 5, [1, 1, 0]), 'Main.dc.html#5:1/1/0');
    assert.equal(encodeBoardName('sub/Coffee & Deck.dc.html'), 'Coffee%20%26%20Deck.dc.html');
    assert.deepEqual(parseAddress('Main.dc.html#5:1/1/0'), { file: 'Main.dc.html', tid: 5, path: [1, 1, 0] });
    assert.equal(parseAddress('Main.dc.html#x'), null);
    assert.equal(formatAddress('Main.dc.html', 1, [100]), null);
  });

  it('resolves only when tid and path agree', () => {
    assert.equal(resolveElement(model, 3, [1, 0])?.tag, 'h1');
    assert.equal(resolveElement(model, 3, [1, 1]), null);
  });

  it('labels and classifies elements', () => {
    assert.equal(elementLabel(model.elements[3]!), '{{title}}');
    assert.equal(elementKind(model.elements[3]!), 'text');
    assert.equal(elementKind(model.elements[2]!), 'shape');
    const svg = parseTemplate('<svg><line x1="0" y1="0" x2="10" y2="0"></line></svg><img alt="A cat" src="/_blob/x">');
    assert.equal(elementKind(svg.elements[0]!), 'line');
    assert.equal(elementKind(svg.elements[2]!), 'image');
    assert.equal(elementLabel(svg.elements[2]!), 'A cat');
  });
});

describe('html round trip', () => {
  it('serializes untouched nodes byte for byte', () => {
    const source = `<div  class='a'  data-x=1>\n  <p>Tom &amp; Jerry</p><br/>\n<!-- note --></div>`;
    assert.equal(serializeNodes(parseHtml(source), source), source);
  });
});

describe('holes', () => {
  it('parses paths and literals, rejects expressions', () => {
    const parts = splitHoles('a {{ user.name }} b {{ a + b }} {{ 3 }}');
    assert.deepEqual(
      parts.map((part) => (part.kind === 'hole' ? part.hole.kind : 'text')),
      ['text', 'path', 'text', 'invalid', 'text', 'literal'],
    );
    const scopes = [{ item: { label: 'One' }, $index: 2 }, { user: { name: 'Ada' } }];
    assert.equal(interpolate('{{user.name}} #{{$index}} {{item.label}}', scopes), 'Ada #2 One');
    assert.equal(evaluateHole({ kind: 'path', segments: ['missing', 'x'], raw: '' }, scopes), undefined);
  });
});

describe('edits', () => {
  const text = `\n<div style="padding: 32px; color: red">\n  <h1>Title</h1>\n  <p class="x">Body</p>\n</div>\n`;
  const model = parseTemplate(text);
  const [div, h1, p] = model.elements as [any, any, any];

  it('patches styles in place', () => {
    assert.equal(patchStyle('padding: 32px; color: red', { color: 'blue', fontSize: '12px', padding: null }), 'color: blue; font-size: 12px');
    const next = applyEdits(model, [setStyle(model, div, { color: 'blue' })]);
    assert.equal(next, text.replace('color: red', 'color: blue'));
  });

  it('sets text and attributes', () => {
    const next = applyEdits(model, [setText(h1, 'A & B\nC'), setAttribute(model, p, 'class', null), setAttribute(model, p, 'id', 'intro')]);
    assert.equal(next, text.replace('<h1>Title</h1>', '<h1>A &amp; B<br>C</h1>').replace('<p class="x">', '<p id="intro">'));
  });

  it('removes and duplicates with their indentation', () => {
    assert.equal(applyEdits(model, [removeElements(model, [h1])]), text.replace('\n  <h1>Title</h1>', ''));
    assert.equal(applyEdits(model, [duplicateElements(model, [p])]), text.replace('<p class="x">Body</p>', '<p class="x">Body</p>\n  <p class="x">Body</p>'));
  });

  it('inserts, moves, wraps and unwraps', () => {
    assert.equal(applyEdits(model, [insertHtml(model, h1, 'after', '<hr>')]), text.replace('</h1>', '</h1>\n  <hr>'));
    assert.equal(applyEdits(model, [moveElements(model, [p], h1, 'before')]), `\n<div style="padding: 32px; color: red">\n  <p class="x">Body</p>\n  <h1>Title</h1>\n</div>\n`);
    const wrapped = applyEdits(model, [wrapElements(model, [h1, p], '<div style="display: flex">', '</div>')]);
    assert.equal(wrapped, `\n<div style="padding: 32px; color: red">\n  <div style="display: flex">\n    <h1>Title</h1>\n    <p class="x">Body</p>\n  </div>\n</div>\n`);
    const again = parseTemplate(wrapped);
    assert.equal(applyEdits(again, [unwrapElement(again, again.elements[1]!)]), text);
  });
});

describe('check', () => {
  it('passes the minimal file', () => {
    const errors = checkDcFile('Main.dc.html', MINIMAL).filter((d) => d.level === 'error');
    assert.deepEqual(errors, []);
  });

  it('reports the rules that bite', () => {
    const bad = MINIMAL.replace('<script src="./support.js"></script>', '')
      .replace('<h1>{{title}}</h1>', '<h1>{{ a + b }}</h1><img src="https://example.com/x.png"><Card/><button onclick="go()">x</button>')
      .replace('class Component extends DCLogic', 'class Thing');
    const messages = checkDcFile('1 bad.dc.html', bad).filter((d) => d.level === 'error').map((d) => d.message);
    assert.ok(messages.some((m) => m.includes('not a valid artboard path')));
    assert.ok(messages.some((m) => m.includes('support.js')));
    assert.ok(messages.some((m) => m.includes('{{ a + b }}')));
    assert.ok(messages.some((m) => m.includes('only Google Fonts')));
    assert.ok(messages.some((m) => m.includes('capitalized')));
    assert.ok(messages.some((m) => m.includes('onclick')));
    assert.ok(messages.some((m) => m.includes('class Component extends DCLogic')));
  });

  // 2026-11-14: the Google Fonts snippet's preconnect links were reported as errors.
  it('allows the Google Fonts snippet, preconnect links included', () => {
    const fonts = MINIMAL.replace(
      '<h1>{{title}}</h1>',
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap"><h1>{{title}}</h1>',
    );
    assert.deepEqual(checkDcFile('Main.dc.html', fonts).filter((d) => d.level === 'error'), []);
    const other = MINIMAL.replace('<h1>{{title}}</h1>', '<link rel="preconnect" href="https://cdn.example.com"><h1>{{title}}</h1>');
    assert.ok(checkDcFile('Main.dc.html', other).some((d) => d.level === 'error'));
  });
});

describe('check: board rules', () => {
  const errorsOf = (source: string, options = {}) => checkDcFile('Main.dc.html', source, options).filter((d) => d.level === 'error').map((d) => d.message);
  const withPreview = (w: number, h: number) => MINIMAL.replace(`data-props='{`, `data-props='{"$preview":{"width":${w},"height":${h}},`);

  it('warns without $preview and errors when it differs from the board', () => {
    assert.ok(checkDcFile('Main.dc.html', MINIMAL).some((d) => d.level === 'warning' && d.message.includes('$preview')));
    assert.deepEqual(errorsOf(withPreview(800, 600), { board: { w: 800, h: 600 } }), []);
    assert.ok(errorsOf(withPreview(800, 600), { board: { w: 1440, h: 900 } }).some((m) => m.includes('800×600')));
  });

  it('wants exactly one logic block', () => {
    const none = MINIMAL.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>\n/, '');
    assert.ok(errorsOf(none).some((m) => m.includes('Missing the <script type="text/x-dc"')));
    const block = /<script type="text\/x-dc"[\s\S]*?<\/script>/.exec(MINIMAL)![0];
    assert.ok(errorsOf(MINIMAL.replace(block, `${block}\n${block}`)).some((m) => m.includes('exactly one')));
  });

  it('refuses UI built from script, globals, key handlers and the network', () => {
    const logic = (code: string) => MINIMAL.replace("return { title:", `${code}\n    return { title:`);
    assert.ok(errorsOf(logic("document.body.innerHTML = '<b>x</b>';")).some((m) => m.includes('innerHTML')));
    assert.ok(errorsOf(logic('window.Card = 1;')).some((m) => m.includes('window.X')));
    assert.ok(errorsOf(logic("window.addEventListener('keydown', () => {});")).some((m) => m.includes('keyboard')));
    assert.ok(errorsOf(logic("fetch('https://api.example.com/x');")).some((m) => m.includes('goes to the network')));
    assert.ok(errorsOf(logic("new WebSocket('ws://x');")).some((m) => m.includes('network connection')));
    assert.deepEqual(errorsOf(logic("fetch('/_blob/0123456789abcdef0123456789abcdef');")), []);
  });

  it('checks head scripts and stylesheets against the project', () => {
    const head = (tag: string) => MINIMAL.replace('</head>', `${tag}\n</head>`);
    const files = new Set(['Main.dc.html', 'shared/theme.css']);
    assert.deepEqual(errorsOf(head('<link rel="stylesheet" href="shared/theme.css">'), { files }), []);
    assert.ok(errorsOf(head('<link rel="stylesheet" href="shared/missing.css">'), { files }).some((m) => m.includes('not a file in this design')));
    assert.ok(errorsOf(head('<script src="https://cdn.example.com/lib.js"></script>'), { files }).some((m) => m.includes('loads from the network')));
  });

  it('checks uploads and image sources', () => {
    const id = '0123456789abcdef0123456789abcdef';
    const img = (src: string) => MINIMAL.replace('<h1>{{title}}</h1>', `<h1>{{title}}</h1><img src="${src}" alt="">`);
    const blobExists = (blob: string) => blob === id;
    assert.deepEqual(errorsOf(img(`/_blob/${id}`), { blobExists }), []);
    assert.ok(errorsOf(img('/_blob/ffffffffffffffffffffffffffffffff'), { blobExists }).some((m) => m.includes('not an upload of this design')));
    assert.ok(errorsOf(img('/_blob/nope'), { blobExists }).some((m) => m.includes('not a valid upload reference')));
    assert.ok(errorsOf(img('blob:http://localhost/x')).some((m) => m.includes('blob: URL')));
    assert.ok(errorsOf(img('photo.png'), { files: new Set(['Main.dc.html']) }).some((m) => m.includes('photo.png')));
    assert.ok(checkDcFile('Main.dc.html', img('data:image/png;base64,AAAA')).some((d) => d.level === 'warning' && d.message.includes('data: URI')));
  });
});

describe('render', () => {
  it('passes <x-import> content as children and props in camelCase', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { renderTemplate } = await import('../src/render.ts');
    const Button = (props: Record<string, unknown>) =>
      createElement('button', { 'data-variant': String(props.variant), 'data-icon': String(props.iconName) }, props.children as never);
    const model = parseTemplate('<x-import component-from-global-scope="Acme.Button" variant="primary" icon-name="{{ icon }}">Pay {{ amount }}</x-import>');
    const html = renderToStaticMarkup(
      renderTemplate(model, { icon: 'card', amount: '$5' }, {
        importComponent: () => null,
        globalComponent: (path) => (path === 'Acme.Button' ? Button : null),
        head: null,
        stamp: false,
        streaming: false,
      }) as never,
    );
    assert.match(html, /<button data-variant="primary" data-icon="card">Pay \$5<\/button>/);
  });
});
