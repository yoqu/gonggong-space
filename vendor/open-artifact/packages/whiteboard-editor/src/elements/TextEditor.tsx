/**
 * The in-place text editor every element view shares (notes, shapes, free
 * text, section titles, arrow labels, table cells and embed sources).
 *
 * Fields with a text profile are edited formatted: a `contentEditable`
 * surface shows bold, italic, code, links and lists as they are drawn, so
 * the person never sees `**`, `- ` or `->` while typing, and each change is
 * read back into the stored Markdown subset (`rich-text.ts`, `rich-dom.ts`).
 * ⌘B and ⌘I set marks where the profile has them; ⌘K opens the format
 * bar's link field; ⌘⇧8 and ⌘⇧7 make bulleted and numbered lists; typing
 * `- ` or `1. ` at a line's start starts a list and `->` draws an arrow.
 * Embed sources (no profile) are edited as plain text.
 *
 * Every change is written through `updateElements` with one coalesce key
 * per edit session (`type:<id>`), so an edit is one undo step and others
 * see it live (table cells write through the table editor instead, see
 * `services/table-edits.ts`). Composition (IME) input is written when it
 * ends. Text stays within the field's cap, counted as stored.
 *
 * Keys follow the field's text profile (core `TEXT_PROFILES`): new lines,
 * list nesting, ending the edit, or handing the key to the host (see
 * `edit.ts`). Escape and leaving the box end the edit; moving focus to the
 * format bar (or a menu it opens) does not.
 */

import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import {
  MAX_HTML_CHARS,
  MAX_LABEL_CHARS,
  autoFitPatch,
  escapeInlineMarkdown,
  normalizeArrowLabel,
  textCutNotice,
  textLimitNotice,
  truncateChars,
  truncateMarkdownText,
  type ElementId,
  type TextProfile,
} from '@open-artifact/whiteboard-core';
import { notify } from '../services/announce.ts';
import { updateElements } from '../state/board.ts';
import { useSelection, type TextEditTarget } from '../state/selection.ts';
import { capText, continueList, indentListLines, keyAction, keyChord, textEditHost, toggleMark, type TextSelection } from './edit.ts';
import { RICH_TEXT_CLIPBOARD_TYPE } from '../lib/rich-clipboard.ts';
import { linkClickAction } from '../lib/link-card.ts';
import { focusLinkCard, hideLinkCard, linkCardFromEditor, openLink } from '../services/link-card.ts';
import {
  BULLETS_PRESS_EVENT,
  LINK_CHORD_EVENT,
  attachTextArrowAutoformat,
  autoformatListShortcut,
  caretListItem,
  copyEditorSelection,
  selectedLinkChip,
  indentListSelection,
  isEditorChromeTarget,
  isRunningFormatCommand,
  lockEditorLinks,
  needsWholeBulletToggle,
  pastePlainText,
  pasteStoredText,
  placeCaretAtEnd,
  renderIntoEditor,
  runEditCommand,
  selectAllOf,
  selectedListItem,
  textBeforeCaret,
  toggleInlineStyle,
  toggleListAtCaret,
  toggleListPreservingCaret,
  type MarkLocks,
} from './rich-dom.ts';
import { serializeEditorText, storedTextCost, toggleBulletLines, type ListKind } from './rich-text.ts';
import type { ViewStyle } from './style.ts';

/* ------------------------------------------------------------------------ */
/* Writing edits                                                            */
/* ------------------------------------------------------------------------ */

/** The coalesce key of an edit session: one undo step per edited element. */
export function editCoalesceKey(id: ElementId): string {
  return `type:${id}`;
}

/** Writes an element's main text (notes and shapes grow to fit it; embeds take it as their HTML). */
export function writeElementText(id: ElementId, text: string): void {
  updateElements(
    [id],
    (element) => {
      switch (element.type) {
        case 'note':
        case 'shape': {
          const next = { ...element, text };
          return { ...next, ...autoFitPatch(next) };
        }
        case 'text':
        case 'container':
          return { ...element, text };
        case 'html':
          return { ...element, html: capText(text, MAX_HTML_CHARS) };
        default:
          return element;
      }
    },
    { coalesce: editCoalesceKey(id), label: 'Edit text' },
  );
}

/** Writes an arrow's label as typed (`final` normalizes it, dropping an empty label). */
export function writeArrowLabel(id: ElementId, text: string, final = false): void {
  const typed = capText(text.replace(/[\r\n]+/g, ' '), MAX_LABEL_CHARS);
  const label = final ? normalizeArrowLabel(typed) : typed;
  updateElements(
    [id],
    (element) => {
      if (element.type !== 'arrow' || element.label === label) return element;
      if (label !== '') return { ...element, label };
      const { label: _dropped, ...rest } = element;
      return rest;
    },
    { coalesce: editCoalesceKey(id), label: 'Edit label' },
  );
}

/* ------------------------------------------------------------------------ */
/* Plain text (embed sources)                                               */
/* ------------------------------------------------------------------------ */

/** Whether the browser edits plain text natively (`contentEditable="plaintext-only"`). */
const PLAINTEXT_ONLY = (() => {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('div');
  try {
    probe.contentEditable = 'plaintext-only';
    return probe.contentEditable === 'plaintext-only';
  } catch {
    return false;
  }
})();

/** Whether ⌘ is the platform's command key. */
const APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** The plain text of the editing box (line breaks from text, `<br>` and block children). */
function readText(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) out += (child as Text).data;
      else if (child.nodeName === 'BR') out += '\n';
      else {
        if ((child.nodeName === 'DIV' || child.nodeName === 'P') && out !== '' && !out.endsWith('\n')) out += '\n';
        walk(child);
      }
    });
  };
  walk(root);
  // A trailing `<br>` only holds an empty last line open.
  if (root.lastChild?.nodeName === 'BR' && out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

/** The selection inside the box as text offsets (the end when there is none). */
function readSelection(root: HTMLElement, text: string): TextSelection {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) return { text, start: text.length, end: text.length };
  const range = selection.getRangeAt(0);
  const offset = (node: Node, at: number) => {
    const before = root.ownerDocument.createRange();
    before.selectNodeContents(root);
    before.setEnd(node, at);
    return Math.min(text.length, before.toString().length);
  };
  return { text, start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
}

/** Replaces the box's content with `text` and selects `start`–`end`. */
function writeBox(root: HTMLElement, { text, start, end }: TextSelection): void {
  root.textContent = text;
  if (text.endsWith('\n')) root.appendChild(root.ownerDocument.createElement('br'));
  const node = root.firstChild;
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const range = root.ownerDocument.createRange();
  if (node && node.nodeType === Node.TEXT_NODE) {
    const length = (node as Text).length;
    range.setStart(node, Math.min(start, length));
    range.setEnd(node, Math.min(end, length));
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Inserts text at the selection, keeping the browser's undo history when it can. */
function insertText(root: HTMLElement, insert: string): void {
  if (root.ownerDocument.execCommand('insertText', false, insert)) return;
  const current = readSelection(root, readText(root));
  const text = current.text.slice(0, current.start) + insert + current.text.slice(current.end);
  writeBox(root, { text, start: current.start + insert.length, end: current.start + insert.length });
}

/* ------------------------------------------------------------------------ */
/* The editor                                                               */
/* ------------------------------------------------------------------------ */

/** Props of {@link TextEditor}. */
export interface TextEditorProps {
  /** What is being edited (ends the edit only while it is still the current target). */
  target: TextEditTarget;
  /** The text when the edit starts. */
  value: string;
  /** Writes the text after each change. */
  onChange(text: string): void;
  /** Writes the final text when the edit ends (defaults to nothing more). */
  onEnd?(text: string): void;
  /** Handles pasted plain text itself; returns `true` when it did (a table cell pasting a grid). */
  onPasteText?(text: string): boolean;
  /** The field's text profile; none for raw source (embeds). */
  profile?: TextProfile | undefined;
  /** Most characters (defaults to the profile's cap). */
  cap?: number | undefined;
  /** Accessible name of the box. */
  label: string;
  /** Id of an element that describes the box (its keys). */
  describedBy?: string | undefined;
  /** Placeholder shown while empty. */
  hint?: string | undefined;
  className?: string | undefined;
  style?: ViewStyle | undefined;
}

/** The in-place text editor (see the module comment): formatted with a profile, plain without. */
export function TextEditor(props: TextEditorProps) {
  return props.profile ? <RichTextEditor {...props} profile={props.profile} /> : <PlainTextEditor {...props} />;
}

/** An edit session: the text written last, and ending it. */
interface EditSession {
  /** The text written last (the start text before any change). */
  latest: { current: string };
  /** Ends the edit once: writes the final text, tells the host and clears the selection's edit. */
  finish(): void;
}

/**
 * The edit session of an editor. The edit also ends when the editor
 * unmounts (another element took the edit, or the element went away);
 * React's development double mount runs that cleanup and mounts again at
 * once, so it ends only when the editor is still gone a moment later.
 */
function useEditSession(target: TextEditTarget, value: string, onEnd: ((text: string) => void) | undefined): EditSession {
  const latest = useRef(value);
  const ended = useRef(false);
  const end = useRef(onEnd);
  end.current = onEnd;
  const session = useRef<EditSession | null>(null);
  session.current ??= {
    latest,
    finish() {
      if (ended.current) return;
      ended.current = true;
      end.current?.(latest.current);
      textEditHost().ended?.(target);
      const selection = useSelection.getState();
      if (selection.editing && sameTarget(selection.editing, target)) selection.edit(null);
    },
  };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) session.current?.finish();
      });
    };
  }, []);
  return session.current;
}

/** Runs a key the profile hands on (`next`, `step`, `host`); returns whether it was one. */
function handOnKey(action: string, target: TextEditTarget, chord: string, backwards: boolean, finish: () => void): boolean {
  switch (action) {
    case 'end':
      finish();
      return true;
    case 'next':
      if (!textEditHost().next?.(target)) finish();
      return true;
    case 'step':
      if (!textEditHost().step?.(target, backwards)) finish();
      return true;
    case 'host':
      if (!(target.kind === 'cell' && textEditHost().cell?.(target, chord))) finish();
      return true;
    default:
      return false;
  }
}

/** The plain-text editor of embed sources (the stored text as typed). */
function PlainTextEditor({ target, value, onChange, onEnd, onPasteText, profile, cap, label, describedBy, hint, className, style }: TextEditorProps) {
  const box = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const session = useEditSession(target, value, onEnd);
  const handlers = useRef({ onChange, onPasteText });
  handlers.current = { onChange, onPasteText };
  const limit = cap ?? profile?.cap ?? Infinity;

  const setBlank = (text: string) => box.current?.toggleAttribute('data-blank', text === '');

  // Fill the box, focus it and place the caret once, when the edit starts.
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const initial = target.kind === 'element' ? target.initial : undefined;
    const start = initial ?? value;
    session.latest.current = start;
    writeBox(root, { text: start, start: target.kind === 'element' && target.selectAll ? 0 : start.length, end: start.length });
    setBlank(start);
    root.focus({ preventScroll: true });
    if (initial !== undefined) handlers.current.onChange(initial);
    // The edit session is keyed by its target; the text is only read at the start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = () => {
    const root = box.current;
    if (!root || composing.current) return;
    const typed = readText(root);
    const text = capText(profile?.lines === 'one' ? typed.replace(/\n/g, ' ') : typed, limit);
    if (text !== typed) writeBox(root, { text, start: text.length, end: text.length });
    setBlank(text);
    if (text === session.latest.current) return;
    session.latest.current = text;
    handlers.current.onChange(text);
  };

  const apply = (next: TextSelection | undefined): boolean => {
    const root = box.current;
    if (!root || !next) return false;
    writeBox(root, next);
    changed();
    return true;
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const root = box.current;
    if (!root) return;
    const chord = keyChord(event, APPLE);
    const keys = profile?.keys;
    if (profile?.marks === 'on' && (chord === 'Mod+B' || chord === 'Mod+I')) {
      event.preventDefault();
      apply(toggleMark(readSelection(root, readText(root)), chord === 'Mod+B' ? '**' : '*'));
      return;
    }
    const backwards = chord === 'Shift+Tab';
    const action = keyAction(keys, chord) ?? (backwards ? keyAction(keys, 'Tab') : undefined) ?? (chord === 'Escape' ? 'end' : undefined);
    if (action === undefined) return;
    event.preventDefault();
    switch (action) {
      case 'line':
        if (profile?.lines === 'one') return session.finish();
        if (profile?.lists && apply(continueList(readSelection(root, readText(root))))) return;
        insertText(root, '\n');
        changed();
        return;
      case 'indent':
        if (profile?.lists) apply(indentListLines(readSelection(root, readText(root)), backwards));
        return;
      default:
        handOnKey(action, target, chord, backwards, session.finish);
    }
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const text = event.clipboardData.getData('text/plain');
    if (handlers.current.onPasteText?.(text)) {
      event.preventDefault();
      return;
    }
    if (PLAINTEXT_ONLY || !box.current) return;
    event.preventDefault();
    insertText(box.current, text);
    changed();
  };

  return (
    <div
      ref={box}
      className={`wb-edit wb-edit-rich ${className ?? ''}`}
      style={style}
      contentEditable={PLAINTEXT_ONLY ? 'plaintext-only' : true}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={profile?.lines !== 'one'}
      aria-label={label}
      aria-describedby={describedBy}
      data-hint={hint ?? profile?.hint}
      data-no-pan=""
      spellCheck={target.kind !== 'element' || className?.includes('wb-edit-mono') !== true}
      onInput={changed}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        changed();
      }}
      onKeyDown={keyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onPaste={paste}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onBlur={session.finish}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

/** How long after pressing editor chrome a blur still counts as moving to it (Safari does not focus pressed buttons). */
const CHROME_PRESS_WINDOW_MS = 1000;

/** How long focus may stay nowhere after leaving editor chrome before it goes back to the text. */
const FOCUS_SETTLE_MS = 150;

/** Font weight from which text counts as bold by its style (bold cannot be toggled in it). */
const BOLD_STYLE_WEIGHT = 600;

/** Whether a key event is a letter shortcut (by its character, or its key position on other layouts). */
function isLetterKey(event: KeyboardEvent, letter: string): boolean {
  const key = event.key.toLowerCase();
  return key === letter || (!/^[a-z]$/.test(key) && event.code === `Key${letter.toUpperCase()}`);
}

/** The formatted editor of fields with a text profile (see the module comment). */
function RichTextEditor({
  target,
  value,
  onChange,
  onEnd,
  onPasteText,
  profile,
  cap,
  label,
  describedBy,
  hint,
  className,
  style,
}: TextEditorProps & { profile: TextProfile }) {
  const box = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const selfDrag = useRef(false);
  const session = useEditSession(target, value, onEnd);
  const handlers = useRef({ onChange, onPasteText });
  handlers.current = { onChange, onPasteText };
  const limit = cap ?? profile.cap;
  /** The stored text the edit started from, and what the surface read back as then. */
  const start = useRef({ text: value, serialized: value });
  /** Notices already shown this edit. */
  const noticed = useRef(new Set<string>());
  /** Stops holding the edit open while focus is in editor chrome. */
  const releaseHold = useRef<(() => void) | null>(null);
  const lastPress = useRef<{ target: EventTarget | null; time: number } | null>(null);

  const doc = (): Document => box.current?.ownerDocument ?? document;
  const notifyOnce = (message: string) => {
    if (noticed.current.has(message)) return;
    noticed.current.add(message);
    notify(message);
  };
  const locks = (): MarkLocks => ({
    bold: profile.marks !== 'on' || box.current?.hasAttribute('data-bold-off') === true,
    italic: profile.marks !== 'on',
  });

  /** Whether inserting `text` over the selection keeps the stored text within the cap. */
  const fits = (text: string): boolean => {
    const selected = storedTextCost(doc().getSelection()?.toString() ?? '', profile);
    return [...session.latest.current].length - selected + storedTextCost(text, profile) <= limit;
  };

  /** Reads the surface back and writes it (cut to the cap, with a notice). */
  const write = () => {
    const root = box.current;
    if (!root || composing.current) return;
    const serialized = serializeEditorText(root, profile);
    let text = serialized === start.current.serialized ? start.current.text : serialized;
    const capped = profile.marks === 'off' ? truncateChars(text, limit) : truncateMarkdownText(text, limit);
    if (capped !== text) {
      renderIntoEditor(root, capped, profile);
      placeCaretAtEnd(root);
      notifyOnce(textCutNotice(limit));
      text = capped;
    }
    root.toggleAttribute('data-blank', text === '');
    if (text === session.latest.current) return;
    session.latest.current = text;
    handlers.current.onChange(text);
  };

  /** Toggles a list on the selected lines (in a list of that kind: takes them out of it). */
  const toggleList = (kind: ListKind) => {
    const root = box.current;
    if (!root || !profile.lists) return;
    const item = selectedListItem(root);
    if (item?.parentElement?.tagName === kind.toUpperCase()) toggleListPreservingCaret(kind, doc());
    else toggleListAtCaret(root, kind);
  };

  /**
   * The bullets button and ⌘⇧8: a bulleted list on the selected lines, or,
   * when the surface holds chips the browser's list command would break,
   * on the whole text (not in table cells, whose bar hides the button then).
   */
  const bullets = () => {
    const root = box.current;
    if (!root || !profile.lists) return;
    if (!needsWholeBulletToggle(root)) return toggleList('ul');
    if (target.kind === 'cell') return;
    const next = toggleBulletLines(session.latest.current);
    if ([...next].length > limit) return notifyOnce(textLimitNotice(limit));
    renderIntoEditor(root, next, profile);
    lockEditorLinks(root);
    placeCaretAtEnd(root);
    write();
  };

  /** Inserts pasted or dropped plain text, within the cap. */
  const insertPlain = (text: string) => {
    const root = box.current;
    if (!root || text === '') return;
    const selected = storedTextCost(doc().getSelection()?.toString() ?? '', profile);
    const room = limit - [...session.latest.current].length + selected;
    if (room <= 0) {
      notifyOnce(textLimitNotice(limit));
      return;
    }
    if (pastePlainText(root, text, profile, room)) notifyOnce(textCutNotice(limit));
  };

  /** Inserts formatted text copied from a field, when it fits; `false` to paste it as plain text instead. */
  const insertStored = (stored: string): boolean => {
    const root = box.current;
    if (!root) return false;
    const selected = storedTextCost(doc().getSelection()?.toString() ?? '', profile);
    const room = limit - [...session.latest.current].length + selected;
    return storedTextCost(stored, profile) <= room && pasteStoredText(root, stored, profile);
  };

  // Fill the surface, focus it and place the caret once, when the edit starts.
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const initial = target.kind === 'element' ? target.initial : undefined;
    const text = initial === undefined ? value : profile.marks === 'off' ? initial : escapeInlineMarkdown(initial);
    renderIntoEditor(root, text, profile);
    start.current = { text, serialized: serializeEditorText(root, profile) };
    session.latest.current = text;
    root.toggleAttribute('data-blank', text === '');
    root.toggleAttribute('data-bold-off', Number(getComputedStyle(root).fontWeight) >= BOLD_STYLE_WEIGHT);
    root.focus({ preventScroll: true });
    try {
      root.ownerDocument.execCommand('defaultParagraphSeparator', false, 'div');
    } catch {
      // Older engines make paragraphs their own way; the reader takes both.
    }
    if (target.kind === 'element' && target.selectAll) selectAllOf(root);
    else placeCaretAtEnd(root);
    if (initial !== undefined) handlers.current.onChange(text);
    // The edit session is keyed by its target; the text is only read at the start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native listeners: input checks (before the arrow drawing, so a refused
  // insert draws nothing), the bullets button, and presses on editor chrome.
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    // Chrome can empty a section title's line without leaving it a caret or firing `input`: the box keeps
    // focus but takes no typing, and the last deletion is never written. Once a deletion has run, an empty
    // box without a caret gets back an empty line with the caret in it, and the text is written.
    const settleEmptied = () => {
      const doc = root.ownerDocument;
      if (!root.isConnected || doc.activeElement !== root || root.textContent !== '') return;
      if (!root.contains(doc.getSelection()?.anchorNode ?? null)) {
        renderIntoEditor(root, '', profile);
        placeCaretAtEnd(root);
      }
      write();
    };
    const onBeforeInput = (event: InputEvent) => {
      if (isRunningFormatCommand()) return;
      const type = event.inputType;
      if (type.startsWith('delete')) setTimeout(settleEmptied, 0);
      if (type.startsWith('format')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type === 'formatBold' || type === 'formatItalic') toggleInlineStyle(type === 'formatBold' ? 'bold' : 'italic', locks(), root.ownerDocument);
        return;
      }
      if (type === 'insertOrderedList' || type === 'insertUnorderedList') {
        if (!profile.lists) event.preventDefault();
        return;
      }
      if (type === 'insertParagraph' || type === 'insertLineBreak') {
        event.preventDefault();
        event.stopImmediatePropagation();
        // Return from an on-screen keyboard: the same as the Return key.
        if (profile.lines === 'one') session.finish();
        else if (fits('\n')) newLine();
        else notifyOnce(textLimitNotice(limit));
        return;
      }
      if (!type.startsWith('insert') || event.isComposing || (type === 'insertFromDrop' && selfDrag.current)) return;
      const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
      if (data !== '' && !fits(data)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        notifyOnce(textLimitNotice(limit));
      }
    };
    const onBullets = () => bullets();
    const onPress = (event: PointerEvent) => {
      lastPress.current = { target: event.target, time: event.timeStamp };
    };
    root.addEventListener('beforeinput', onBeforeInput);
    const stopArrows = attachTextArrowAutoformat(root);
    root.addEventListener(BULLETS_PRESS_EVENT, onBullets);
    root.ownerDocument.addEventListener('pointerdown', onPress, true);
    return () => {
      root.removeEventListener('beforeinput', onBeforeInput);
      stopArrows();
      root.removeEventListener(BULLETS_PRESS_EVENT, onBullets);
      root.ownerDocument.removeEventListener('pointerdown', onPress, true);
      releaseHold.current?.();
    };
    // Bound once per edit session, like the start above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A new line: a new paragraph or list item; on an empty list item, the item moves out a level instead. */
  const newLine = () => {
    const root = box.current;
    if (!root) return;
    const item = caretListItem(root);
    if (item !== null && item.textContent === '' && item.querySelector('ul, ol') === null) {
      indentListSelection(root, true, fits, true);
      return;
    }
    runEditCommand(root.ownerDocument, 'insertParagraph');
  };

  const input = (event: FormEvent<HTMLDivElement>) => {
    const root = box.current;
    const native = event.nativeEvent;
    if (!root || composing.current || (native instanceof InputEvent && native.isComposing)) return;
    if (native instanceof InputEvent) autoformatListShortcut(root, native, (surface) => serializeEditorText(surface, profile), profile.lists ? ['ul', 'ol'] : []);
    lockEditorLinks(root);
    write();
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const root = box.current;
    if (!root) return;
    const chord = keyChord(event, APPLE);
    // The link card first: Escape hides it, Tab moves into it; Alt+Enter opens the link at the caret.
    if ((chord === 'Escape' && linkCardFromEditor()) || (chord === 'Tab' && focusLinkCard())) {
      event.preventDefault();
      if (chord === 'Escape') hideLinkCard();
      return;
    }
    const caretHref = chord === 'Alt+Return' ? selectedLinkChip(root.ownerDocument)?.dataset.href : undefined;
    if (caretHref !== undefined) {
      event.preventDefault();
      openLink(caretHref, target);
      return;
    }
    const keys = profile.keys;
    const backwards = chord === 'Shift+Tab';
    const action = keyAction(keys, chord) ?? (backwards ? keyAction(keys, 'Tab') : undefined) ?? (chord === 'Escape' ? 'end' : undefined);
    if (action !== undefined) {
      event.preventDefault();
      if (action === 'line') {
        if (profile.lines === 'one') session.finish();
        else if (fits('\n')) newLine();
        else notifyOnce(textLimitNotice(limit));
      } else if (action === 'indent') {
        if (profile.lists) indentListSelection(root, backwards, fits);
      } else {
        handOnKey(action, target, chord, backwards, session.finish);
      }
      return;
    }
    const mod = APPLE ? event.metaKey : event.ctrlKey;
    if (chord === 'Backspace' && profile.lists) {
      const selection = root.ownerDocument.getSelection();
      if (selection?.isCollapsed && caretListItem(root) !== null && textBeforeCaret(root.ownerDocument) === '') {
        event.preventDefault();
        indentListSelection(root, true, fits, true);
      }
      return;
    }
    if (!mod || event.altKey) return;
    if (!event.shiftKey && isLetterKey(event, 'k')) {
      event.preventDefault();
      if (profile.marks === 'on') root.dispatchEvent(new CustomEvent(LINK_CHORD_EVENT, { bubbles: true }));
      return;
    }
    if (event.shiftKey && (event.code === 'Digit8' || event.code === 'Digit7')) {
      event.preventDefault();
      if (event.code === 'Digit8') bullets();
      else toggleList('ol');
      return;
    }
    if (!event.shiftKey && (isLetterKey(event, 'b') || isLetterKey(event, 'i') || isLetterKey(event, 'u'))) {
      event.preventDefault();
      if (isLetterKey(event, 'u')) return;
      toggleInlineStyle(isLetterKey(event, 'b') ? 'bold' : 'italic', locks(), root.ownerDocument);
    }
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (handlers.current.onPasteText?.(text)) return;
    const stored = event.clipboardData.getData(RICH_TEXT_CLIPBOARD_TYPE);
    if (stored !== '' && insertStored(stored)) return;
    insertPlain(text);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    const own = selfDrag.current;
    selfDrag.current = false;
    // Moving text within the field is the browser's; files go on to the board.
    if (own || event.dataTransfer.types.includes('Files')) return;
    event.stopPropagation();
    event.preventDefault();
    const text = event.dataTransfer.getData('text/plain');
    const at = caretRangeAt(event.clientX, event.clientY);
    const selection = doc().getSelection();
    if (at && selection && box.current?.contains(at.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(at);
    }
    if (!handlers.current.onPasteText?.(text)) insertPlain(text);
  };

  const blur = (event: { relatedTarget: EventTarget | null }) => {
    const press = lastPress.current;
    const toChrome =
      isEditorChromeTarget(event.relatedTarget) ||
      (event.relatedTarget === null && press !== null && performance.now() - press.time < CHROME_PRESS_WINDOW_MS && isEditorChromeTarget(press.target));
    if (toChrome) holdFocus();
    else session.finish();
  };

  /**
   * Keeps the edit while focus is in editor chrome: it ends when focus
   * lands anywhere else, and stops holding when it comes back here.
   */
  const holdFocus = () => {
    const root = box.current;
    if (!root || releaseHold.current) return;
    const owner = root.ownerDocument;
    let check: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(check);
      owner.removeEventListener('focusin', onFocusIn, true);
      owner.removeEventListener('focusout', onFocusOut, true);
      releaseHold.current = null;
    };
    const settle = (again = true) => {
      const active = owner.activeElement;
      if (!root.isConnected) return release();
      if (active !== null && (root.contains(active) || isEditorChromeTarget(active))) return;
      if (active === null || active === owner.body) {
        // Focus went nowhere (a menu closed): look once more, then go back to the text.
        if (again) check = setTimeout(() => settle(false), FOCUS_SETTLE_MS);
        else {
          release();
          root.focus({ preventScroll: true });
        }
        return;
      }
      release();
      session.finish();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (root.contains(event.target as Node | null)) release();
      else if (!isEditorChromeTarget(event.target)) settle();
    };
    // Focus may go nowhere (a menu closing, a pressed button that does not
    // take focus): look again once it settles.
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget !== null) return;
      clearTimeout(check);
      check = setTimeout(() => settle(), 0);
    };
    owner.addEventListener('focusin', onFocusIn, true);
    owner.addEventListener('focusout', onFocusOut, true);
    releaseHold.current = release;
  };

  // Mod-click on a link opens it (a plain click puts the caret by it, which shows its card).
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest<HTMLElement>('a[data-href]');
    if (!link || linkClickAction(event, APPLE) !== 'now') return;
    event.preventDefault();
    const href = link.dataset.href;
    if (href) openLink(href, target);
  };

  return (
    <div
      ref={box}
      className={`wb-edit wb-edit-rich ${className ?? ''}`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={profile.lines !== 'one'}
      aria-label={label}
      aria-describedby={describedBy}
      data-hint={hint ?? profile.hint}
      data-marks={profile.marks}
      data-lists={profile.lists ? '' : undefined}
      data-cap={limit}
      data-no-pan=""
      spellCheck={target.kind !== 'element' || className?.includes('wb-edit-mono') !== true}
      onInput={input}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        write();
      }}
      onKeyDown={keyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onPaste={paste}
      onCopy={(event) => {
        event.stopPropagation();
        copyEditorSelection(event.nativeEvent, event.currentTarget, profile, false);
      }}
      onCut={(event) => {
        event.stopPropagation();
        copyEditorSelection(event.nativeEvent, event.currentTarget, profile, true);
      }}
      onDragStart={() => {
        selfDrag.current = true;
      }}
      onDragEnd={() => {
        selfDrag.current = false;
      }}
      onDrop={drop}
      onBlur={blur}
      onClick={click}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

/** The caret position at a viewport point. */
function caretRangeAt(x: number, y: number): Range | null {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) {
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
  }
  return document.caretRangeFromPoint?.(x, y) ?? null;
}

/** Whether two edit targets are the same field. */
export function sameTarget(a: TextEditTarget, b: TextEditTarget): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  return a.kind !== 'cell' || (b.kind === 'cell' && a.row === b.row && a.col === b.col);
}

/** The edit target of an element view while it is being edited, else `null` (narrow selector). */
export function useEditing<K extends TextEditTarget['kind']>(id: ElementId, kind: K): Extract<TextEditTarget, { kind: K }> | null {
  return useSelection((state) => (state.editing?.id === id && state.editing.kind === kind ? (state.editing as Extract<TextEditTarget, { kind: K }>) : null));
}
