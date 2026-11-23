/**
 * The Ask panel: a box above the tool bar where a person writes a request
 * for the agent about the board, the selection or a dragged area. Enter
 * sends (Shift+Enter starts a new line), Escape closes and keeps the draft.
 *
 * ⌘K (Ctrl+K) opens it about the selection, or the board when nothing is
 * selected, and closes it again ({@link startAskKeys}).
 *
 * Text files dropped on the panel (or the board) or pasted into its field
 * are attached to the request and shown as chips with a remove button; they
 * travel with the next request only (`attached-files.ts`).
 */

import { ArrowUp, FileText, Frame, LayoutGrid, MousePointer2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn, toast } from '@open-artifact/ui';
import { isBoardMediaFile } from '../lib/media.ts';
import { middleCut } from '../lib/middle-cut.ts';
import { announce } from '../services/announce.ts';
import { useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { useAsk, type AskScope } from '../state/ask.ts';
import { useSelection } from '../state/selection.ts';
import { Card, ChromeButton, Tip } from '../ui/chrome.tsx';
import { useFocusThroughDisable } from '../ui/hooks.ts';
import { askAgent, type AskTarget } from './asks.ts';
import { MAX_ASK_TEXT } from './ask-status.ts';
import {
  attachedFilesContext,
  clipboardTextIsFileNames,
  dropAttachedFile,
  giveBackAttachedFiles,
  offerTextFiles,
  takeAttachedFiles,
  useAttachedFiles,
} from './attached-files.ts';
import { isTypingTarget } from './cursor-chat.ts';

/** The request target for a panel scope. */
export function scopeTarget(scope: AskScope): AskTarget {
  switch (scope.kind) {
    case 'selection':
      return { kind: 'selection', ids: [...scope.ids] };
    case 'area':
      return { kind: 'area', rect: scope.rect };
    default:
      return { kind: 'board' };
  }
}

/** The chip naming what a request is about. */
function scopeLabel(scope: AskScope): string {
  switch (scope.kind) {
    case 'selection':
      return scope.ids.length === 1 ? 'About 1 selected item' : `About ${scope.ids.length} selected items`;
    case 'area':
      return 'About the area you dragged';
    default:
      return 'About the board';
  }
}

function ScopeIcon({ scope }: { scope: AskScope }) {
  const Icon = scope.kind === 'selection' ? MousePointer2 : scope.kind === 'area' ? Frame : LayoutGrid;
  return <Icon aria-hidden="true" className="size-3.5" />;
}

/** Opens the panel about the selection (or the board), or closes it. */
export function toggleAskPanel(): void {
  const ask = useAsk.getState();
  if (ask.open) {
    ask.hide();
    return;
  }
  const ids = useSelection.getState().ids;
  ask.show(ids.length > 0 ? { kind: 'selection', ids: [...ids] } : { kind: 'board' });
}

/** True when this viewer may ask the agent now. */
export function canAsk(): boolean {
  return useAgent.getState().available && (maybeSession()?.canAsk ?? false);
}

/**
 * Attaches the files that are not pictures or videos to the Ask panel and
 * opens it (about the selection, or the board); when this viewer cannot
 * ask, says what the board takes instead.
 */
export function offerFilesToAsk(files: readonly File[]): void {
  void offerTextFiles(files, {
    canAsk,
    isOpen: () => useAsk.getState().open,
    open: () => {
      const ids = useSelection.getState().ids;
      useAsk.getState().show(ids.length > 0 ? { kind: 'selection', ids: [...ids] } : { kind: 'board' });
    },
    toast: (message) => toast.add({ title: message }),
    announce,
  });
}

/** Sends the panel's request with the attached files; a request that fails gives them back. */
async function sendWithFiles(text: string, target: AskTarget, via: 'panel' | 'area'): Promise<void> {
  const files = takeAttachedFiles();
  const result = await askAgent({ text, target, via, ...(files.length > 0 ? { files: attachedFilesContext(files) } : {}) });
  if (files.length === 0 || (result !== undefined && result.status !== 'failed')) return;
  for (const message of giveBackAttachedFiles(files)) toast.add({ title: message });
}

/** True when a drag carries files. */
function dragHasFiles(event: ReactDragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files');
}

/** Characters of a file name a chip shows; longer names are cut in the middle. */
const CHIP_NAME_CHARS = 24;

/** The attached files, as chips with a remove button (a long name keeps its extension; the full name is the tooltip). */
function AttachedFileChips() {
  const files = useAttachedFiles((state) => state.files);
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Attached files">
      {files.map((file) => (
        <li key={file.n} className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-[6px] bg-chrome-hover pl-2 pr-0.5 text-[12px] text-chrome-fg">
          <FileText aria-hidden="true" className="size-3.5 shrink-0 text-chrome-muted" />
          <span className="min-w-0 truncate" title={file.name}>
            {middleCut(file.name, CHIP_NAME_CHARS)}
          </span>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-chrome-muted hover:bg-chrome-line hover:text-chrome-fg"
            onClick={() => {
              dropAttachedFile(file.n);
              announce(`Removed ${file.name}.`);
            }}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Listens for ⌘K / Ctrl+K; returns a function that stops. */
export function startAskKeys(): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() !== 'k') return;
    // Text being edited on the board keeps ⌘K for itself (links).
    if (useSelection.getState().editing !== null) return;
    if (isTypingTarget(event.target) && !(event.target instanceof Element && event.target.closest('.wb-ask-panel'))) return;
    if (!canAsk()) return;
    event.preventDefault();
    toggleAskPanel();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** The Ask panel (renders nothing while closed). */
export function AskPanel() {
  const open = useAsk((state) => state.open);
  const scope = useAsk((state) => state.scope);
  const draft = useAsk((state) => state.draft);
  const available = useAgent((state) => state.available);
  const name = useAgent((state) => state.name);
  const lastFile = useAttachedFiles((state) => state.files.reduce((most, file) => Math.max(most, file.n), 0));
  const [dropOver, setDropOver] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const keepFocus = useFocusThroughDisable(field, !available);

  // Opening, a new scope or a newly attached file puts the caret in the field.
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open, scope, lastFile]);

  if (!open) return null;

  const send = (): void => {
    const text = useAsk.getState().draft.trim();
    if (text === '' || !available) return;
    const current = useAsk.getState().scope;
    void sendWithFiles(text, scopeTarget(current), current.kind === 'area' ? 'area' : 'panel');
    useAsk.getState().setDraft('');
    useAsk.getState().hide();
  };
  const onDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropOver(true);
  };
  const onDragLeave = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropOver(false);
  };
  const onDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    setDropOver(false);
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = [...event.dataTransfer.files];
    // Pictures and videos still go on the board; text files are attached.
    if (files.some(isBoardMediaFile)) void import('../services/files.ts').then(({ insertFiles }) => insertFiles(files));
    else offerFilesToAsk(files);
  };
  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...event.clipboardData.files];
    const text = event.clipboardData.getData('text/plain');
    if (files.length === 0 || (text !== '' && !clipboardTextIsFileNames(files, text))) return;
    const textFiles = files.filter((file) => !isBoardMediaFile(file));
    if (textFiles.length === 0) return;
    event.preventDefault();
    offerFilesToAsk(textFiles);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      useAsk.getState().hide();
    }
  };

  return (
    <Card className="wb-ask-panel" data-wb-region="ask" role="dialog" aria-label={`Ask ${name}`} data-drop-over={dropOver ? '' : undefined} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="flex w-full flex-col gap-1.5 p-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-chrome-hover px-2 text-[12px] text-chrome-muted">
            <ScopeIcon scope={scope} />
            {scopeLabel(scope)}
          </span>
          {scope.kind !== 'board' ? (
            <button type="button" className="text-[12px] text-chrome-muted underline-offset-2 hover:underline" onClick={() => useAsk.getState().show({ kind: 'board' })}>
              Ask about the board instead
            </button>
          ) : null}
          <span className="flex-1" />
          <Tip label="Close" shortcut="Esc" side="top">
            <ChromeButton square aria-label="Close" onClick={() => useAsk.getState().hide()}>
              <X aria-hidden="true" />
            </ChromeButton>
          </Tip>
        </div>
        <AttachedFileChips />
        <div className="flex items-end gap-1.5">
          <textarea
            ref={field}
            rows={2}
            value={draft}
            maxLength={MAX_ASK_TEXT}
            disabled={!available}
            placeholder={available ? `Ask ${name} to add, change or explain something` : 'No agent is connected to this board.'}
            aria-label={`Request for ${name}`}
            className="min-h-12 max-h-48 flex-1 resize-none rounded-[8px] bg-chrome-field px-2.5 py-2 text-[14px] leading-5 text-chrome-fg outline-none ring-1 ring-chrome-ring placeholder:text-chrome-muted focus:ring-chrome-accent"
            onChange={(event) => useAsk.getState().setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            {...keepFocus}
          />
          <Tip label="Send" shortcut="Enter" side="top">
            <ChromeButton
              square
              size="lg"
              aria-label="Send"
              disabled={!available || draft.trim() === ''}
              onClick={send}
              className={cn('bg-chrome-accent text-white hover:bg-chrome-accent/90', (!available || draft.trim() === '') && 'opacity-40')}
            >
              <ArrowUp aria-hidden="true" />
            </ChromeButton>
          </Tip>
        </div>
      </div>
    </Card>
  );
}
