/**
 * Cursor chat: `/` opens a line at the pointer that everyone on the board
 * sees next to this viewer's cursor while it is typed (presence `chat`).
 * Enter shows the line a few seconds longer and clears it.
 *
 * Tab turns the line into a request to the agent about that spot (presence
 * `chatAsk`, so colleagues see it is a request): Enter then sends it with a
 * point target. Escape while asking keeps the words for the Ask panel.
 */

import { create } from 'zustand';
import { useAgent } from '../services/agent.ts';
import { useAsk } from '../state/ask.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { announce } from './announce.ts';
import { askAgent } from './asks.ts';
import { hasRoom, pointerOnBoard, publishPresence } from './presence.ts';
import type { Point } from '../lib/camera.ts';

/** Most characters of a chat line. */
export const MAX_CHAT_CHARS = 50;

/** Most characters of a request typed at the cursor. */
export const MAX_CHAT_ASK_CHARS = 500;

/** How long a sent line stays up (ms), then fades over {@link CHAT_FADE_MS}. */
export const CHAT_HOLD_MS = 5000;

/** Fade of a sent line (ms). */
export const CHAT_FADE_MS = 600;

/** How long a peer's request at the cursor stays up after it stops changing (ms). */
export const CHAT_ASK_HOLD_MS = 15_000;

interface CursorChatState {
  /** The line is open for typing. */
  open: boolean;
  text: string;
  /** The line is a request to the agent. */
  asking: boolean;
  /** Where the line was opened (board units). */
  at: Point | null;
  /** A sent line still showing (board units), fading after its hold. */
  sent: { text: string; at: Point; fading: boolean } | null;
}

/** The cursor chat line. */
export const useCursorChat = create<CursorChatState>()(() => ({ open: false, text: '', asking: false, at: null, sent: null }));

let sentTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearSentTimers(): void {
  for (const timer of sentTimers) clearTimeout(timer);
  sentTimers = [];
}

/** Opens the line at the pointer; false when it cannot open now. */
export function openCursorChat(): boolean {
  const at = pointerOnBoard();
  if (!at || !hasRoom()) return false;
  clearSentTimers();
  useCursorChat.setState({ open: true, text: '', asking: false, at, sent: null });
  publishPresence({ chat: null, chatAsk: null });
  return true;
}

/** Updates the typed text (shared with everyone as it is typed). */
export function setCursorChatText(text: string): void {
  const { asking } = useCursorChat.getState();
  const clipped = [...text.replace(/[\r\n]+/g, ' ')].slice(0, asking ? MAX_CHAT_ASK_CHARS : MAX_CHAT_CHARS).join('');
  useCursorChat.setState({ text: clipped });
  publishPresence({ chat: clipped.trim() === '' ? null : clipped, chatAsk: asking && clipped.trim() !== '' ? true : null });
}

/** Turns asking the agent on or off (Tab). */
export function toggleCursorChatAsking(): void {
  const { asking, text } = useCursorChat.getState();
  if (!asking && !useAgent.getState().available) {
    announce('No agent is connected to this board.');
    return;
  }
  const next = !asking;
  const clipped = next ? text : [...text].slice(0, MAX_CHAT_CHARS).join('');
  useCursorChat.setState({ asking: next, text: clipped });
  publishPresence({ chat: clipped.trim() === '' ? null : clipped, chatAsk: next && clipped.trim() !== '' ? true : null });
  announce(next ? 'Ready to ask the agent. Colleagues still read this. Enter sends. Tab stops asking. Escape keeps it for the chat box.' : 'Chat with colleagues.');
}

/** Closes the line. While asking, the words move to the Ask panel's draft. */
export function closeCursorChat(): void {
  const { asking, text } = useCursorChat.getState();
  if (asking && text.trim() !== '') useAsk.getState().setDraft(text);
  useCursorChat.setState({ open: false, text: '', asking: false, at: null });
  publishPresence({ chat: null, chatAsk: null });
}

/** Sends the line: a request to the agent while asking, else a chat line that lingers. */
export function sendCursorChat(): void {
  const { asking, text, at } = useCursorChat.getState();
  const body = text.trim();
  if (body === '' || !at) {
    closeCursorChat();
    return;
  }
  useCursorChat.setState({ open: false, text: '', asking: false, at: null });
  if (asking) {
    publishPresence({ chat: null, chatAsk: null });
    void askAgent({ text: body, target: { kind: 'point', point: at }, via: 'cursor-chat' });
    return;
  }
  clearSentTimers();
  useCursorChat.setState({ sent: { text: body, at, fading: false } });
  publishPresence({ chat: body, chatAsk: null });
  sentTimers.push(
    setTimeout(() => {
      useCursorChat.setState((state) => (state.sent ? { sent: { ...state.sent, fading: true } } : state));
    }, CHAT_HOLD_MS),
    setTimeout(() => {
      useCursorChat.setState({ sent: null });
      if (!useCursorChat.getState().open) publishPresence({ chat: null });
    }, CHAT_HOLD_MS + CHAT_FADE_MS),
  );
}

/** True when the key event's target takes typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]') !== null;
}

/** Listens for `/` over the board; returns a function that stops. */
export function startCursorChat(): () => void {
  if (!hasRoom()) return () => {};
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (isTypingTarget(event.target) || useSelection.getState().editing !== null || useTool.getState().commentMode) return;
    if (useCursorChat.getState().open) return;
    if (openCursorChat()) event.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    clearSentTimers();
    if (useCursorChat.getState().open) closeCursorChat();
    useCursorChat.setState({ sent: null });
  };
}
