/**
 * The card of the link the caret is in while text is typed into: the
 * address, and Open, Copy link, Edit and Remove. Tab from the text moves into
 * it, Escape gives the focus back to the text; focus leaving both ends the
 * editing as it would from the text.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LinkCard, toast } from '@open-artifact/ui';
import { writeClipboardText } from '@open-artifact/editor-kit';
import { activeEditor, LINK_CARD } from './TextEditor.tsx';
import { typedLink } from '../lib/link.ts';
import { maybeSession } from '../services/session.ts';
import { useView } from '../state/view.ts';

/** The link the caret is in, inside the text being typed into. */
function caretLink(): HTMLAnchorElement | null {
  const editor = activeEditor();
  const node = document.getSelection()?.anchorNode ?? null;
  const element = node instanceof Element ? node : node?.parentElement;
  const anchor = element?.closest('a');
  return anchor && editor?.contains(anchor) ? anchor : null;
}

/** Focuses the text again, with the caret at the end of `anchor`. */
function returnTo(anchor: HTMLAnchorElement): void {
  const editor = activeEditor();
  if (!editor) return;
  editor.focus({ preventScroll: true });
  if (!anchor.isConnected) return;
  const range = document.createRange();
  range.selectNodeContents(anchor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Runs an editing command on the whole link, through the browser so that
 * undo while typing takes it back, and leaves the caret after its text.
 */
function onLink(anchor: HTMLAnchorElement, command: 'createLink' | 'unlink', value?: string): void {
  const editor = activeEditor();
  if (!editor || !anchor.isConnected) return;
  editor.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(anchor);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand(command, false, value);
  selection?.collapseToEnd();
}

async function copy(target: string): Promise<void> {
  try {
    await writeClipboardText(target, maybeSession()?.shell);
    toast.add({ title: 'Copied link' });
  } catch {
    toast.add({ title: 'Could not copy link', description: target });
  }
}

export function TextLinkCard(): ReactNode {
  const editing = useView((s) => s.textEdit !== null);
  const [link, setLink] = useState<HTMLAnchorElement | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!editing) {
      setLink(null);
      return;
    }
    const follow = (): void => {
      if (document.activeElement?.closest(`[${LINK_CARD}]`)) return;
      setLink(caretLink());
    };
    follow();
    document.addEventListener('selectionchange', follow);
    return () => document.removeEventListener('selectionchange', follow);
  }, [editing]);

  if (!link || !link.isConnected || !activeEditor()) return null;
  const target = link.getAttribute('href') ?? '';
  return createPortal(
    <div
      {...{ [LINK_CARD]: '' }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && (event.currentTarget.contains(next) || activeEditor()?.contains(next))) return;
        if (next instanceof Element && next.closest('[data-open-artifact-format-bar]')) return;
        useView.getState().endTextEdit();
      }}
    >
      <LinkCard
        key={`${target}:${revision}`}
        link={link}
        target={target}
        href={link.href}
        normalize={typedLink}
        invalidMessage="Links must start with http:// or https://"
        className="z-[1000]"
        onCopy={(address) => void copy(address)}
        onEdit={(address) => {
          onLink(link, 'createLink', address);
          setRevision((n) => n + 1);
          return true;
        }}
        onRemove={() => onLink(link, 'unlink')}
        onReturn={() => returnTo(link)}
      />
    </div>,
    document.body,
  );
}
