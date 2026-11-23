import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasInlineFormat, richClipboardHtml } from '../src/lib/rich-clipboard.ts';

describe('formatted text on the clipboard', () => {
  it('goes out formatted only when it has links or marks', () => {
    assert.equal(hasInlineFormat('plain words'), false);
    assert.equal(hasInlineFormat('escaped \\*stars\\*'), false);
    assert.equal(hasInlineFormat('one **bold** word'), true);
    assert.equal(hasInlineFormat('first line\nsee [docs](https://example.com)'), true);
  });

  it('gives other apps clean HTML: marks as tags, links with only their address', () => {
    assert.equal(richClipboardHtml('**Ship** it *now*'), '<strong>Ship</strong> it <em>now</em>');
    assert.equal(richClipboardHtml('see [the "docs"](https://example.com/?a=1&b=2)'), 'see <a href="https://example.com/?a=1&amp;b=2">the &quot;docs&quot;</a>');
    assert.equal(richClipboardHtml('a < b\n- item'), 'a &lt; b<br>- item');
  });
});
