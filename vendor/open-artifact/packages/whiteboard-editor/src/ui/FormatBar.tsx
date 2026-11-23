/**
 * The format controls of the typing bar: what the selection bar shows in
 * place of its usual commands while text is edited in place. Bold and
 * italic (pressed when all of the selection has them), a link (⌘K too),
 * and a bulleted list; the selection bar puts them among the element's own
 * controls (kind, size, color, alignment, fill, lock and the rest).
 *
 * The link control turns the whole bar into a web address field for the
 * selection (or, at a caret, the whole text, or the link at the caret):
 * Return links it, Escape goes back to the text, Remove unlinks. The text
 * being linked stays highlighted (`::highlight(wb-linking)`) meanwhile.
 *
 * The controls follow the editing surface the selection is in, whose
 * profile they read from its `data-*` attributes (`TextEditor.tsx`), and
 * act on it with the commands of `elements/rich-dom.ts`; the editor keeps
 * the edit open while focus is in this bar or a menu it opens.
 *
 * Given a `whole` item (one note, shape or text selected, not being typed
 * into), the same controls act on all of its text: bold and italic toggle
 * the mark over the whole text; link and bullets start editing with all of
 * the text selected, then run as they would while typing.
 */

import { Bold, Italic, Link2, List } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_TEXT_PROFILE, MAX_TEXT_CHARS, textProfileForElement, type InlineToken } from '@open-artifact/whiteboard-core';
import { markCoverage, markDisabledReason, type RichTextItem, type TextMark } from '../elements/mark-across.ts';
import {
  BULLETS_PRESS_EVENT,
  LINK_CHORD_EVENT,
  captureLinkTarget,
  editableRootOfRange,
  linkEditCostInRange,
  linkSelectionTo,
  needsWholeBulletToggle,
  readSelectionFormat,
  relinkLink,
  toggleInlineStyle,
  unlinkLink,
  type LinkTarget,
  type MarkLocks,
} from '../elements/rich-dom.ts';
import {
  INVALID_LINK_MESSAGE,
  LINK_TOO_LONG_MESSAGE,
  editorBlocks,
  normalizeTextLinkUrl,
  serializeEditorText,
  visibleLinkHref,
  type EditorBlock,
} from '../elements/rich-text.ts';
import { isApplePlatform } from '../lib/tools.ts';
import { LINK_EDIT_MESSAGES, announce, notify } from '../services/announce.ts';
import { toggleSelectionMark } from '../services/text-marks.ts';
import { useSelection } from '../state/selection.ts';
import { ChromeButton, ToolButton, type ChromeSide } from './chrome.tsx';

/** Said when the link field opens. */
export const LINK_FIELD_MESSAGES = {
  edit: 'Edit the link, then press Return',
  field: 'Type a web address, then press Return',
} as const;

/** The format buttons, for the selection bar to place. */
export interface FormatControls {
  /** Bold, italic and link. */
  marks: ReactNode[];
  /** The bulleted list button (none when it cannot work here). */
  bullets: ReactNode;
}

/** Props of {@link FormatBar}. */
export interface FormatBarProps {
  /** The side of the bar its tooltips and menus open on. */
  side: ChromeSide;
  /** Whether a table cell is being edited. */
  cell: boolean;
  /**
   * The selected item when its text is not being typed: the controls then
   * work on all of its text (bold and italic at once; link and bullets
   * start typing with everything selected, then act).
   */
  whole?: RichTextItem;
  /** Lays the bar out around the format buttons (not called while the link field shows). */
  children(controls: FormatControls): ReactNode;
}

/** The link field's state: what it links, the address typed and what is wrong with it. */
interface Linking extends LinkTarget {
  url: string;
  bad: string;
}

/** A shortcut as the platform writes it (⌘K, Ctrl+K). */
function chordLabel(key: string, shift = false): string {
  return isApplePlatform() ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** Focuses and selects the link field when it appears. */
function selectOnMount(input: HTMLInputElement | null): void {
  input?.focus({ preventScroll: true });
  input?.select();
}

/** The editing surface the document selection is in. */
function selectionEditable(): HTMLElement | null {
  const selection = document.getSelection();
  return selection && selection.rangeCount > 0 ? editableRootOfRange(selection.getRangeAt(0)) : null;
}

/** The names of the mark buttons. */
const MARK_LABELS: Readonly<Record<TextMark, string>> = { bold: 'Bold', italic: 'Italic' };

/** Frames to wait for a started edit's text field before giving up. */
const EDIT_START_FRAMES = 30;

/**
 * Starts typing into an item with all of its text selected, then hands the
 * text field to `then` once it has focus (link and bullets on the whole
 * text work through the field, as while typing).
 */
function typeIntoWhole(item: RichTextItem, then: (root: HTMLElement) => void): void {
  useSelection.getState().edit({ kind: 'element', id: item.id, selectAll: true, formatted: true });
  let frames = 0;
  const wait = (): void => {
    const root = selectionEditable();
    if (root !== null && document.activeElement === root) {
      then(root);
      return;
    }
    if (++frames < EDIT_START_FRAMES) requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}

/** Every line's tokens of some blocks, lists included. */
function blockLines(blocks: readonly EditorBlock[]): InlineToken[][] {
  const lines: InlineToken[][] = [];
  const walk = (block: EditorBlock): void => {
    if (block.kind === 'p') lines.push(block.tokens);
    else
      for (const item of block.items) {
        lines.push(item.tokens);
        item.lists.forEach(walk);
      }
  };
  blocks.forEach(walk);
  return lines;
}

/** The format controls for an item's whole text (not being typed). */
function wholeControls(item: RichTextItem, side: ChromeSide): FormatControls {
  const profile = textProfileForElement(item) ?? DEFAULT_TEXT_PROFILE;
  const blocks = editorBlocks(item.text, profile);
  const links = blockLines(blocks)
    .flat()
    .flatMap((token) => (token.kind === 'link' ? [token.href] : []));
  const words = item.text.trim() !== '';
  const marksOn = profile.marks === 'on';
  const markButton = (mark: TextMark) => {
    const reason = marksOn ? markDisabledReason(mark, item) : '';
    return (
      <ToolButton
        key={mark}
        label={MARK_LABELS[mark]}
        tip={reason !== '' ? reason : undefined}
        tipSide={side}
        shortcut={chordLabel(mark === 'bold' ? 'B' : 'I')}
        icon={mark === 'bold' ? <Bold aria-hidden="true" /> : <Italic aria-hidden="true" />}
        pressed={markCoverage(item.text, profile, mark).all}
        disabled={!marksOn || reason !== ''}
        onClick={() => toggleSelectionMark(mark)}
      />
    );
  };
  const bulleted = blocks.length > 0 && blocks.every((block) => block.kind === 'ul');
  return {
    marks: [
      markButton('bold'),
      markButton('italic'),
      <ToolButton
        key="link"
        label="Link"
        tip={links[0] !== undefined ? `Edit the link to ${visibleLinkHref(links[0])}` : words ? 'Link the whole text' : 'Add a link'}
        tipSide={side}
        icon={<Link2 aria-hidden="true" />}
        pressed={links.length > 0}
        disabled={!marksOn}
        onClick={() => typeIntoWhole(item, () => document.dispatchEvent(new CustomEvent(LINK_CHORD_EVENT)))}
      />,
    ],
    bullets: profile.lists ? (
      <ToolButton
        key="bullets"
        label="Bulleted list"
        tipSide={side}
        icon={<List aria-hidden="true" />}
        pressed={bulleted}
        onClick={() => typeIntoWhole(item, (root) => root.dispatchEvent(new CustomEvent(BULLETS_PRESS_EVENT)))}
      />
    ) : null,
  };
}

/** The typing bar's format controls, or its link field (see the module comment). */
export function FormatBar({ side, cell, whole, children }: FormatBarProps): ReactNode {
  const [, rerender] = useState(0);
  const bump = () => rerender((count) => count + 1);
  const [linking, setLinking] = useState<Linking | null>(null);
  const linkingRef = useRef(linking);
  linkingRef.current = linking;
  const openLink = useRef(() => {});

  // ⌘K in the editor opens the link field.
  useEffect(() => {
    const open = () => openLink.current();
    document.addEventListener(LINK_CHORD_EVENT, open);
    return () => document.removeEventListener(LINK_CHORD_EVENT, open);
  }, []);

  // Follow the selection and typing (pressed states, link labels). The
  // editor stops its keys from bubbling, so keys are heard on the way down.
  useEffect(() => {
    document.addEventListener('selectionchange', bump);
    document.addEventListener('input', bump, true);
    document.addEventListener('keyup', bump, true);
    return () => {
      document.removeEventListener('selectionchange', bump);
      document.removeEventListener('input', bump, true);
      document.removeEventListener('keyup', bump, true);
    };
  }, []);

  // Highlight what the link field works on.
  const words = linking?.words;
  useEffect(() => {
    const target = linkingRef.current;
    if (target === null || typeof Highlight !== 'function' || !CSS.highlights) return;
    const around = (node: Node) => {
      const range = document.createRange();
      range.selectNode(node);
      return range;
    };
    CSS.highlights.set('wb-linking', new Highlight(...(target.chips.length > 0 ? target.chips.map(around) : [target.words])));
    return () => void CSS.highlights.delete('wb-linking');
  }, [words]);

  /** Closes the link field; `href` links (or relinks) the text, `null` unlinks it, none keeps it. */
  const finishLinking = (href?: string | null) => {
    const target = linkingRef.current;
    linkingRef.current = null;
    setLinking(null);
    const root = target && target.chips.every((chip) => chip.isConnected) ? editableRootOfRange(target.range) : null;
    if (!target || !root) return;
    root.focus({ preventScroll: true });
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(target.range);
    if (href === undefined || href === target.chips[0]?.dataset.href) return;
    selection?.removeAllRanges();
    selection?.addRange(target.words);
    if (href === null) for (const chip of target.chips) unlinkLink(chip);
    else if (!(target.chips.length > 0 ? target.chips.map((chip) => relinkLink(chip, href)).some(Boolean) : linkSelectionTo(href))) {
      announce(LINK_EDIT_MESSAGES.kept);
      return;
    }
    root.dispatchEvent(new Event('input', { bubbles: true }));
    announce(href === null ? LINK_EDIT_MESSAGES.removed : target.chips.length > 0 ? LINK_EDIT_MESSAGES.changed : LINK_EDIT_MESSAGES.added);
  };

  // Going back to the text closes the link field, keeping the text as it was.
  const isLinking = linking !== null;
  useEffect(() => {
    if (!isLinking) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = linkingRef.current;
      if (target !== null && event.target === editableRootOfRange(target.range)) finishLinking();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
    // finishLinking reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLinking]);

  const startLinking = () => {
    const target = captureLinkTarget(document);
    if (target === null) return;
    setLinking({ ...target, url: visibleLinkHref(target.chips[0]?.dataset.href ?? ''), bad: '' });
    announce(target.chips.length > 0 ? LINK_FIELD_MESSAGES.edit : LINK_FIELD_MESSAGES.field);
  };
  openLink.current = startLinking;

  if (linking !== null) {
    const submit = () => {
      if (linking.chips.length > 0 && linking.url === visibleLinkHref(linking.chips[0]?.dataset.href ?? '')) return finishLinking();
      const href = normalizeTextLinkUrl(linking.url);
      const root = editableRootOfRange(linking.words);
      const old = linking.chips[0]?.dataset.href ?? '';
      const growth =
        href === null || root === null ? 0 : linking.chips.length > 0 ? linking.chips.length * (href.length - old.length) : linkEditCostInRange(root, linking.words, href);
      const cap = Number(root?.dataset.cap) || MAX_TEXT_CHARS;
      const problem = href === null ? INVALID_LINK_MESSAGE : root !== null && [...serializeEditorText(root)].length + growth > cap ? LINK_TOO_LONG_MESSAGE : '';
      if (href !== null && problem === '') return finishLinking(href);
      setLinking({ ...linking, bad: problem });
      if (problem === LINK_TOO_LONG_MESSAGE && linking.bad !== problem) notify(problem);
      else announce(problem);
    };
    return (
      <form
        data-link-field=""
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          ref={selectOnMount}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={linking.url}
          onChange={(event) => setLinking({ ...linking, url: event.target.value, bad: '' })}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (!event.currentTarget.ownerDocument.hasFocus()) return;
            if (next instanceof Element && next.closest('[data-link-field]')) return;
            // Focus going back to the text is handled by the focusin listener above.
            if (next === editableRootOfRange(linking.range)) return;
            setLinking(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Tab' && event.shiftKey) {
              event.preventDefault();
              finishLinking();
              return;
            }
            if ((isApplePlatform() ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k') event.preventDefault();
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              finishLinking();
            }
          }}
          placeholder="Paste a web address"
          aria-label="Web address"
          aria-invalid={linking.bad !== '' ? true : undefined}
          className="h-8 w-60 max-w-[calc(100vw-200px)] rounded-[8px] bg-chrome-field px-2 text-[14px] text-chrome-fg outline-none ring-1 ring-inset ring-chrome-line placeholder:text-chrome-muted focus-visible:ring-2 focus-visible:ring-chrome-accent"
        />
        {linking.bad !== '' ? (
          <span role="status" className="max-w-40 truncate px-1 text-[12px] text-chrome-muted">
            {linking.bad}
          </span>
        ) : null}
        {linking.chips.length > 0 ? (
          <ChromeButton size="lg" onClick={() => finishLinking(null)}>
            Remove
          </ChromeButton>
        ) : null}
      </form>
    );
  }

  if (whole !== undefined) return children(wholeControls(whole, side));

  const editable = selectionEditable();
  const marksOn = editable?.dataset.marks === 'on';
  const locks: MarkLocks = { bold: !marksOn || editable?.hasAttribute('data-bold-off') === true, italic: !marksOn };
  const format = editable ? readSelectionFormat(document, locks) : { allBold: false, allItalic: false, ul: false, ol: false };
  const links = editable ? (captureLinkTarget(document)?.chips ?? []) : [];
  const selection = document.getSelection();
  const linkTip = links[0]
    ? `Edit the link to ${visibleLinkHref(links[0].dataset.href ?? '')}`
    : (editable?.textContent ?? '').trim() === ''
      ? 'Add a link'
      : selection?.isCollapsed === false
        ? 'Link the selected text'
        : 'Link the whole text';
  const markButton = (mark: 'bold' | 'italic') => (
    <ToolButton
      key={mark}
      label={MARK_LABELS[mark]}
      tipSide={side}
      shortcut={chordLabel(mark === 'bold' ? 'B' : 'I')}
      icon={mark === 'bold' ? <Bold aria-hidden="true" /> : <Italic aria-hidden="true" />}
      pressed={mark === 'bold' ? format.allBold : format.allItalic}
      disabled={editable === null || locks[mark]}
      onClick={() => {
        toggleInlineStyle(mark, locks);
        bump();
      }}
    />
  );
  const wholeBullets = editable !== null && needsWholeBulletToggle(editable);
  const bulletsShown = editable?.hasAttribute('data-lists') === true && !(wholeBullets && cell);

  return children({
    marks: [
      markButton('bold'),
      markButton('italic'),
      <ToolButton
        key="link"
        label="Link"
        tip={linkTip}
        tipSide={side}
        shortcut={chordLabel('K')}
        icon={<Link2 aria-hidden="true" />}
        pressed={links.length > 0}
        disabled={editable === null || !marksOn}
        onClick={startLinking}
      />,
    ],
    bullets: bulletsShown ? (
      <ToolButton
        key="bullets"
        label="Bulleted list"
        tipSide={side}
        shortcut={chordLabel('8', true)}
        icon={<List aria-hidden="true" />}
        pressed={format.ul}
        onClick={() => {
          editable?.dispatchEvent(new CustomEvent(BULLETS_PRESS_EVENT));
          bump();
        }}
      />
    ) : null,
  });
}
