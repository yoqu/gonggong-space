import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FilmModule } from '../src/documents.ts';
import {
  applyRetyped,
  decodeScriptEscapes,
  editableWords,
  filmTextSources,
  findEndedRetypedLines,
  foldRetypedText,
  hideLaterWords,
  isLineGone,
  pruneRetypedLines,
  readScriptText,
  retypeLine,
  scanFilmWords,
  scanStringLiterals,
  scanTextSites,
  snapshotRetypedSites,
  type ShownText,
} from '../src/retype/index.ts';

const html = (name: string, text: string): FilmModule => ({ name, kind: 'html', text });
const js = (name: string, text: string): FilmModule => ({ name, kind: 'js', text });

const SCRIPT = [
  "kit.scene('intro', () => {",
  "  title('Hello world');",
  "  el.innerHTML = '<h1>Big &amp; bold</h1>';",
  "  el.setAttribute('class', 'hero banner');",
  "  const n = '42';",
  '  const t = `Count ${n} apples`;',
  '});',
].join('\n');

const film = { script: SCRIPT, modules: [html('card.html', '<p>Welcome home</p><style>.x{color:red}</style>'), { name: 'scenes.json', kind: 'json' as const, text: '{"title":"Not a line"}' }] };

describe('string literals', () => {
  it('reads strings, template parts, and skips regular expressions and comments', () => {
    const source = "const a = 'one'; // 'not'\nconst r = /'x'/g; const b = `two ${a} three`;";
    const scan = scanStringLiterals(source);
    assert.ok(scan !== null);
    assert.deepEqual(
      scan.literals.map((literal) => literal.map((span) => source.slice(span.start, span.end))),
      [['one'], ['two ', ' three']],
    );
  });

  it('gives up on an unclosed string', () => {
    assert.equal(scanStringLiterals("const a = 'open"), null);
  });

  it('marks the arguments of script calls', () => {
    const source = "el.setAttribute('class', 'big'); setTimeout('go()', 10); show('Shown words');";
    const scan = scanStringLiterals(source)!;
    const scripted = scan.literals.filter((literal) => scan.script.has(literal)).map((literal) => source.slice(literal[0]!.start, literal[0]!.end));
    assert.deepEqual(scripted, ['class', 'big', 'go()']);
  });
});

describe('scanFilmWords', () => {
  it('lists the lines the film shows, not scene ids, script strings, numbers or data', () => {
    const words = scanFilmWords(film);
    assert.deepEqual(
      words.map((word) => word.was),
      ['Hello world', 'Big &amp; bold', 'Count', 'apples', 'Welcome home'],
    );
    assert.equal(words.find((word) => word.was === 'Big &amp; bold')?.words, 'Big & bold');
    assert.deepEqual(words.find((word) => word.was === 'Welcome home')?.sources, ['card.html']);
  });

  it('counts each place a line is said', () => {
    const words = scanFilmWords({ script: "a('Same words'); b('Same words');", modules: [] });
    assert.deepEqual(words, [{ was: 'Same words', words: 'Same words', places: 2, sources: [''] }]);
  });
});

describe('applyRetyped', () => {
  it('swaps lines in, writes & as &amp; in markup, and reports the lines no longer said', () => {
    const record = {
      lines: [
        { was: 'Hello world', v: 'Hi there' },
        { was: 'Big &amp; bold', v: 'Big & brave' },
        { was: 'Welcome home', v: 'Come in' },
        { was: 'Gone line', v: 'Nothing' },
      ],
    };
    const result = applyRetyped(film, record);
    assert.equal(result.swapped, 3);
    assert.deepEqual(result.unmatched, [{ was: 'Gone line', v: 'Nothing' }]);
    assert.match(result.script, /title\('Hi there'\)/);
    assert.match(result.script, /<h1>Big &amp; brave<\/h1>/);
    assert.equal(result.modules[0]!.text, '<p>Come in</p><style>.x{color:red}</style>');
    assert.equal(result.modules[1], film.modules[1]);
  });

  it('round-trips: putting the words back gives the original code', () => {
    const changed = applyRetyped(film, { lines: [{ was: 'Hello world', v: 'Hi there' }] });
    const back = applyRetyped(changed, { lines: [{ was: 'Hi there', v: 'Hello world' }] });
    assert.equal(back.script, film.script);
  });

  it('leaves the film alone for an empty record', () => {
    const result = applyRetyped(film, { lines: [] });
    assert.equal(result.script, film.script);
    assert.equal(result.swapped, 0);
  });
});

describe('escapes', () => {
  it('decodes the escapes a line may show, and refuses those that make markup', () => {
    assert.equal(readScriptText('caf\\xe9'), 'café');
    assert.equal(decodeScriptEscapes("It\\'s"), "It's");
    assert.equal(decodeScriptEscapes('\\x3cb'), null);
    assert.equal(decodeScriptEscapes('a\\nb'), null);
    assert.equal(decodeScriptEscapes('a\\nb', true), 'a\nb');
  });

  it('folds typography so two spellings of the same words match', () => {
    assert.equal(foldRetypedText('“Wait…” — it’s &amp; done'), '"Wait..."-it\'s & done');
  });

  it('reads escaped lines when the escapes keep the markup', () => {
    const { sites } = scanTextSites([{ name: '', kind: 'js', text: "say('caf\\xe9 au lait');" }]);
    assert.deepEqual(
      sites.map((site) => site.was),
      ['caf\\xe9 au lait'],
    );
  });
});

describe('retypeLine', () => {
  const sources = filmTextSources(film);
  const scan = scanTextSites(sources);

  it('records new words, and drops a line typed back to what the code says', () => {
    const outcome = retypeLine({ lines: [] }, 'Hello world', '  Hi   "there"  ', { scan });
    assert.equal(outcome.kind, 'changed');
    if (outcome.kind !== 'changed') return;
    assert.deepEqual(outcome.record.lines, [{ was: 'Hello world', v: 'Hi “there”' }]);
    const back = retypeLine(outcome.record, 'Hello world', 'Hello world', { scan });
    assert.equal(back.kind, 'changed');
    if (back.kind === 'changed') assert.deepEqual(back.record.lines, []);
  });

  it('says when nothing changes, or the line is gone', () => {
    assert.equal(retypeLine({ lines: [{ was: 'Hello world', v: 'Hi' }] }, 'Hello world', 'Hi', { scan }).kind, 'same');
    assert.equal(retypeLine({ lines: [] }, 'Not in the film', 'New', { scan }).kind, 'gone');
    assert.equal(isLineGone(null, 'Hello world'), true);
    assert.equal(isLineGone(scan, 'Hello world'), false);
  });
});

describe('pruneRetypedLines', () => {
  it('drops only the lines nothing reads any more', () => {
    const record = {
      lines: [
        { was: 'Hello world', v: 'Hi' },
        { was: 'it’s here', v: 'Here' },
        { was: 'Long gone', v: 'Gone' },
      ],
    };
    const pruned = pruneRetypedLines(record, ["title('Hello world'); say(\"it's here\");"]);
    assert.deepEqual(
      pruned.lines.map((line) => line.was),
      ['Hello world', 'it’s here'],
    );
    const kept = { lines: [{ was: 'Hello world', v: 'Hi' }] };
    assert.equal(pruneRetypedLines(kept, ["title('Hello world')"]), kept);
  });
});

describe('editableWords', () => {
  it('lists the lines on the picture, the ones shown later, and retyped lines no longer on screen', () => {
    const sources = filmTextSources(film);
    const { sites } = scanTextSites(sources);
    const nodes: ShownText[] = [
      { text: 'Hello world', box: { x: 10, y: 10, w: 200, h: 40 }, line: 40, id: 'a:1', seen: true },
      { text: 'Big & bold', box: { x: 10, y: 60, w: 100, h: 20 }, line: 20, id: 'b:1', seen: true },
      { text: 'Welcome home', box: null, line: 16, seen: false },
    ];
    const typed = [
      { was: 'Hello world', v: 'Hi there' },
      { was: 'Old words', v: 'New words' },
    ];
    const words = editableWords({ nodes, keptLine: null, sites, shown: [], typed, pending: true });
    const hello = words.find((word) => word.id === 'Hello world');
    assert.equal(hello?.group, null);
    assert.equal(hello?.text, 'Hi there');
    assert.equal(hello?.changed, true);
    assert.equal(hello?.line, 'a:1');
    assert.equal(words.find((word) => word.id === 'Big &amp; bold')?.text, 'Big & bold');
    assert.equal(words.find((word) => word.id === 'Welcome home')?.group, 'later');
    assert.equal(hideLaterWords(words).some((word) => word.id === 'Welcome home'), false);
  });
});

describe('ended lines', () => {
  it('finds a retyped line the agent rewrote the text around', () => {
    const before = [js('', "title('Hello world');")];
    const lines = [{ was: 'Hello world', v: 'Hi there' }];
    const stood = snapshotRetypedSites(before, scanTextSites(before).sites, lines);
    const after = [js('', "title('Hello world, friends');")];
    const ended = findEndedRetypedLines(stood, after, scanTextSites(after), lines);
    assert.deepEqual(ended, [{ was: 'Hello world', v: 'Hi there', old: 'Hello world', now: 'Hello world, friends', nowWas: 'Hello world, friends' }]);
  });

  it('finds nothing while the line still shows', () => {
    const sources = [js('', "title('Hello world');")];
    const lines = [{ was: 'Hello world', v: 'Hi there' }];
    const stood = snapshotRetypedSites(sources, scanTextSites(sources).sites, lines);
    assert.deepEqual(findEndedRetypedLines(stood, sources, scanTextSites(sources), lines), []);
  });
});
