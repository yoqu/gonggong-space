/**
 * This viewer's cursor chat line, in screen units next to where it was
 * opened: a one-line field while typing, then the sent line for a few
 * seconds. Tab turns the line into a request to the agent.
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { boardToScreen } from '../lib/camera.ts';
import { useCamera } from '../state/camera.ts';
import { closeCursorChat, sendCursorChat, setCursorChatText, toggleCursorChatAsking, useCursorChat, MAX_CHAT_ASK_CHARS, MAX_CHAT_CHARS } from './cursor-chat.ts';
import { useMyColor } from './hooks.ts';

/** Offset of the line from the pointer (px). */
const OFFSET = { x: 10, y: 16 } as const;

/** Width kept free for the line when clamping it into the view (px). */
const LINE_WIDTH = 260;

/** The cursor chat line and the sent line. */
export function CursorChatBox() {
  const open = useCursorChat((state) => state.open);
  const text = useCursorChat((state) => state.text);
  const asking = useCursorChat((state) => state.asking);
  const at = useCursorChat((state) => state.at);
  const sent = useCursorChat((state) => state.sent);
  const camera = useCamera((state) => state.camera);
  const width = useCamera((state) => state.width);
  const height = useCamera((state) => state.height);
  const color = useMyColor();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const anchor = open ? at : sent?.at;
  if (!anchor) return null;
  const point = boardToScreen(camera, anchor);
  const left = Math.min(Math.max(8, point.x + OFFSET.x), Math.max(8, width - LINE_WIDTH));
  const top = Math.min(Math.max(8, point.y + OFFSET.y), Math.max(8, height - 48));
  const style = { transform: `translate(${left}px, ${top}px)`, ['--wb-peer' as string]: color };

  if (!open && sent) {
    return (
      <div className="wb-own-chat" data-fading={sent.fading ? '' : undefined} style={style} aria-hidden="true">
        <span className="wb-cursor-chat-text">{sent.text}</span>
      </div>
    );
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      sendCursorChat();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeCursorChat();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      toggleCursorChatAsking();
    }
  };

  return (
    <div className="wb-own-chat" data-asking={asking ? '' : undefined} data-wb-chrome="" style={style}>
      {asking ? <span className="wb-cursor-chat-tag">@Agent</span> : null}
      <input
        ref={field}
        className="wb-own-chat-field"
        value={text}
        maxLength={asking ? MAX_CHAT_ASK_CHARS : MAX_CHAT_CHARS}
        placeholder={asking ? 'Ask the agent about this spot' : 'Say something'}
        aria-label={asking ? 'Ask the agent' : 'Cursor chat'}
        onChange={(event) => setCursorChatText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (useCursorChat.getState().open) closeCursorChat();
        }}
      />
    </div>
  );
}
