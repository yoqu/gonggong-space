/**
 * Draws element text: the limited Markdown of the board (bold, italic,
 * code, `http(s)` links, bullet and numbered lists, typed arrows) parsed by
 * core's `parseRichText` into React elements.
 *
 * Lists hang by the widest top-level marker (`--wb-hang`, in `ch` of the
 * text's own font) so wrapped lines align under the text, not the marker.
 * Links open in a new tab when a click on them is meant to open them (see
 * `PassiveLink`). List items take their direction from their own
 * text (`dir="auto"`), so right-to-left items read and hang correctly.
 */

import { memo, type ReactNode } from 'react';
import {
  DEFAULT_TEXT_PROFILE,
  textWidthInZeroChars,
  parseRichText,
  type InlineToken,
  type NestedTextBlock,
  type NestedTextList,
  type TextProfile,
} from '@open-artifact/whiteboard-core';
import { PassiveLink } from './PassiveLink.tsx';
import { hangStyle, type PaperFont } from './style.ts';

/** One inline token. */
function Token({ token }: { token: InlineToken }): ReactNode {
  switch (token.kind) {
    case 'text':
      return token.text;
    case 'bold':
      return <strong>{token.text}</strong>;
    case 'italic':
      return <em>{token.text}</em>;
    case 'bolditalic':
      return (
        <strong>
          <em>{token.text}</em>
        </strong>
      );
    case 'code':
      return <code>{token.text}</code>;
    case 'link':
      return (
        <PassiveLink href={token.href} className="wb-text-link">
          {token.text}
        </PassiveLink>
      );
  }
}

/** A line of inline tokens (`<br>` keeps an empty line's height). */
function Spans({ spans }: { spans: readonly InlineToken[] }): ReactNode {
  if (spans.length === 0) return <br />;
  return spans.map((token, index) => <Token key={index} token={token} />);
}

/** A nested list. */
function List({ list }: { list: NestedTextList<InlineToken[]> }): ReactNode {
  const items = list.items.map((item) => (
    <li key={item.row} dir="auto">
      <Spans spans={item.text} />
      {item.lists.map((nested, index) => (
        <List key={index} list={nested} />
      ))}
    </li>
  ));
  return list.kind === 'ol' ? <ol start={list.start}>{items}</ol> : <ul>{items}</ul>;
}

/** A top-level block: a paragraph line or a list. */
function Block({ block }: { block: NestedTextBlock<InlineToken[]> }): ReactNode {
  if (block.kind === 'p')
    return (
      <div>
        <Spans spans={block.text} />
      </div>
    );
  return <List list={block} />;
}

/** Props of {@link RichText}. */
export interface RichTextProps {
  /** The stored text (limited Markdown). */
  text: string;
  /** How the field treats its text (lists, marks); the block profile by default. */
  profile?: TextProfile | undefined;
  /** The font the text is set in, for the hanging indent of lists. */
  font?: PaperFont | undefined;
}

/** Element text drawn as rich text. */
export const RichText = memo(function RichText({ text, profile = DEFAULT_TEXT_PROFILE, font }: RichTextProps) {
  const measureMark = font ? (sample: string) => textWidthInZeroChars(sample, font.px, font.weight) : undefined;
  const tree = parseRichText(text, profile, measureMark);
  if (tree.kind === 'inline') return <Spans spans={tree.spans} />;
  if (tree.kind === 'lines')
    return (
      <>
        {tree.lines.map((spans, index) => (
          <div key={index}>
            <Spans spans={spans} />
          </div>
        ))}
        {tree.trailingNewline && (
          <div>
            <br />
          </div>
        )}
      </>
    );
  return (
    <div className="wb-lines" style={hangStyle(tree.hang)}>
      {tree.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
});
