/**
 * The view of an HTML embed: a small tab with the page's title above a
 * card that runs the HTML in a sandboxed frame (see `embed.ts`).
 *
 * The frame takes pointer events only while the embed is "live": selected
 * alone with the select tool. Otherwise presses fall through to the board,
 * so an embed moves and selects like any element. While its source is
 * being edited, a monospace editor replaces the frame.
 *
 * The frame and the board keep in touch over the bootstrap's private port
 *:
 * - the keyboard: the frame may hold it after a press inside it or Enter
 *   on it (`embed-control.ts`), and only then does its page get typing,
 *   paste and drops; Escape inside it comes back to the board
 *   (keeping it selected when Enter had entered it). Focus it takes
 *   otherwise is taken back, and the third time the embed is stopped, with
 *   a "Run it again" button;
 * - a heartbeat: a frame that stops answering is hidden, and stopped when
 *   it stays silent. Beats are not counted while the page is hidden (the
 *   browser may pause the frame then).
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { MAX_HTML_CHARS, htmlDocumentTitle, type HtmlElement } from '@open-artifact/whiteboard-core';
import { announce } from '../services/announce.ts';
import { maybeSession } from '../services/session.ts';
import { updateElements } from '../state/board.ts';
import { useSelection } from '../state/selection.ts';
import { effectiveTool, useTool } from '../state/tool.ts';
import { editTextActionLabel } from './describe.ts';
import {
  buildEmbedSrcdoc,
  canRunEmbedAgain,
  createFloodGuard,
  createHeartbeat,
  createKeyboardGuard,
  createStateSaver,
  embedKeyboardStopMessage,
  embedRefusal,
  embedStopHint,
  EMBED_FOCUS_SETTLE_MS,
  EMBED_HEARTBEAT_MS,
  EMBED_STOP_MESSAGES,
  isEmbedPortOffer,
  isEmbedSaveMessage,
  readEmbedPortMessage,
  type EmbedBoardMessage,
  type EmbedStateMessage,
  type EmbedStopReason,
} from './embed.ts';
import { embedStopFor, focusBoardHome, registerEmbedFrame, runEmbedAgain, stopEmbed, useEmbedStops } from './embed-control.ts';
import { useItemProps } from './item.tsx';
import { rotationStyle, type ViewStyle } from './style.ts';
import { TextEditor, useEditing, writeElementText } from './TextEditor.tsx';

/** How often a frame looks whether it holds the keyboard, ms. */
const FOCUS_POLL_MS = 100;

/** Whether an embed takes pointer events: selected alone, with the select tool. */
function useIsLive(id: HtmlElement['id']): boolean {
  const alone = useSelection((state) => state.ids.length === 1 && state.ids[0] === id);
  const selecting = useTool((state) => effectiveTool(state) === 'select' && !state.commentMode);
  return alone && selecting;
}

/** Whether an embed is live right now (read outside React). */
function isLiveNow(id: HtmlElement['id']): boolean {
  const ids = useSelection.getState().ids;
  const tool = useTool.getState();
  return ids.length === 1 && ids[0] === id && effectiveTool(tool) === 'select' && !tool.commentMode;
}

/** Writes an embed's state for everyone (not an undo step). */
function writeEmbedState(id: HtmlElement['id'], state: string): void {
  updateElements([id], (element) => (element.type === 'html' && element.state !== state ? { ...element, state } : element), { coalesce: `embed:${id}`, history: false });
}

/** An HTML embed (see the module comment). */
export const HtmlView = memo(function HtmlView({ element }: { element: HtmlElement }) {
  const item = useItemProps(element);
  const editing = useEditing(element.id, 'element');
  const live = useIsLive(element.id);
  const title = htmlDocumentTitle(element.html) ?? 'Embed';
  const style: ViewStyle = { left: element.x, top: element.y, width: element.w, height: element.h, ...rotationStyle(element) };
  return (
    <div {...item} className="wb-el wb-html" style={style} {...(live ? { 'data-wb-live': '' } : {})}>
      <div className="wb-html-tab" title={title}>
        {title}
      </div>
      <div className="wb-html-card">
        {editing ? (
          <TextEditor
            target={editing}
            value={element.html}
            onChange={(text) => writeElementText(element.id, text)}
            cap={MAX_HTML_CHARS}
            label={editTextActionLabel(element)}
            hint="<!doctype html>…"
            className="wb-edit-mono"
          />
        ) : (
          <EmbedFrame element={element} title={title} />
        )}
      </div>
    </div>
  );
});

/** What a stopped (or refused) embed shows instead of its frame. */
function StoppedEmbed({ id, reason, refusal }: { id: HtmlElement['id']; reason: EmbedStopReason | undefined; refusal: string | undefined }) {
  const hint = refusal === undefined && reason !== undefined ? embedStopHint(reason) : undefined;
  const again = refusal === undefined && reason !== undefined && canRunEmbedAgain(reason);
  return (
    <div className="wb-html-stopped" role="note">
      <div>
        <strong>This embed was stopped.</strong> {refusal ?? EMBED_STOP_MESSAGES[reason ?? 'navigated']}
        {hint !== undefined ? ` ${hint}` : null}
      </div>
      {again ? (
        <button
          type="button"
          className="wb-html-again"
          data-no-pan=""
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={() => runEmbedAgain(id)}
        >
          <RotateCw size={14} aria-hidden="true" />
          Run it again
        </button>
      ) : null}
    </div>
  );
}

/** The sandboxed frame of an embed, bridged to the board's copy of its state and guarded (see the module comment). */
function EmbedFrame({ element, title }: { element: HtmlElement; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { id, html } = element;
  const stopped = useEmbedStops((state) => embedStopFor(state.stops, id, html));
  const [silent, setSilent] = useState(false);
  const refusal = embedRefusal(html);
  // The state at the time the HTML (re)loads; later changes are posted to the frame.
  const stateRef = useRef(element.state);
  // A stop ending (run again) reloads the frame with the state as it is then.
  const srcdoc = useMemo(() => buildEmbedSrcdoc(html, stateRef.current), [html, stopped]);
  const saver = useMemo(() => createStateSaver((state) => writeEmbedState(id, state)), [id]);

  // A layout effect, so the listeners are in place before the frame's bootstrap can post its port.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node || refusal !== undefined || stopped !== undefined) return undefined;
    setSilent(false);
    const flood = createFloodGuard();
    const guard = createKeyboardGuard();
    const heartbeat = createHeartbeat();
    let port: MessagePort | null = null;
    let loads = 0;
    let ended = false;
    /** Whether Enter (not a press) handed the frame the keyboard. */
    let enteredByKey = false;
    let looking: ReturnType<typeof setTimeout> | undefined;
    /** Whether this page had focus the last time the frame did not hold it. */
    let inPage = document.hasFocus();
    /** What last lost focus on this page (not a frame), since the last look. */
    let lastFocusOut: HTMLElement | SVGElement | null = null;

    const holds = (): boolean => document.activeElement === node;

    /** Tells the frame it was entered or left: typing, paste and drops reach its page only while entered. */
    const tellEntered = (enter: boolean): void => {
      if (ended || port === null) return;
      const message: EmbedBoardMessage = { enter };
      port.postMessage(message);
    };

    /** Takes the keyboard back: to what had it, else the board, or the host page when this page did not have it. */
    const takeBack = (previous: HTMLElement | SVGElement | null, wasInPage: boolean): void => {
      if (!holds()) return;
      if (!wasInPage && window.top !== window) {
        try {
          window.top?.focus();
        } catch {
          /* The host page may refuse. */
        }
        if (holds()) node.blur();
        return;
      }
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      if (holds()) focusBoardHome();
      if (holds()) node.blur();
    };

    const stop = (reason: EmbedStopReason): void => {
      if (ended) return;
      ended = true;
      const hadKeyboard = holds();
      stopEmbed(id, html, reason);
      if (hadKeyboard) focusBoardHome();
      if (reason === 'keyboard') announce(embedKeyboardStopMessage(htmlDocumentTitle(html)));
    };

    /** The frame took the keyboard without leave: judge it in a moment (a press may still be on its way). */
    const look = (): void => {
      if (looking !== undefined) return;
      const previous = lastFocusOut;
      const wasInPage = inPage;
      looking = setTimeout(() => {
        looking = undefined;
        if (ended) return;
        const verdict = guard.settle(performance.now());
        if (verdict === 'keep') return;
        takeBack(previous, wasInPage);
        if (verdict === 'stop') stop('keyboard');
      }, EMBED_FOCUS_SETTLE_MS);
    };

    const check = (): void => {
      if (ended) return;
      if (holds()) {
        if (!guard.owner) look();
      } else {
        if (document.hasFocus()) guard.left(performance.now());
        inPage = document.hasFocus();
      }
      lastFocusOut = null;
    };

    /** Escape inside the frame: back to the board (still selected when Enter had entered it). */
    const leave = (): void => {
      guard.release();
      tellEntered(false);
      const selection = useSelection.getState();
      if (!enteredByKey && selection.ids.length === 1 && selection.ids[0] === id) selection.clear();
      enteredByKey = false;
      focusBoardHome();
    };

    const onPortMessage = (event: MessageEvent): void => {
      if (ended) return;
      if (flood.hit()) {
        stop('flooded');
        return;
      }
      const message = readEmbedPortMessage(event.data);
      if (message === undefined) return;
      if (message.kind === 'press') {
        if (guard.pressed(message.age, isLiveNow(id), performance.now())) enteredByKey = false;
      } else if (message.kind === 'key') leave();
      else if (heartbeat.echo(message.n)) setSilent(false);
    };

    const onMessage = (event: MessageEvent): void => {
      if (ended || event.source !== node.contentWindow) return;
      if (flood.hit()) {
        stop('flooded');
        return;
      }
      if (isEmbedPortOffer(event.data)) {
        // Only the first offer of a load is the bootstrap's (it runs before the embed's code).
        const offered = event.ports[0];
        if (port === null && offered !== undefined) {
          port = offered;
          port.onmessage = onPortMessage;
        }
        return;
      }
      if (!isEmbedSaveMessage(event.data) || !(maybeSession()?.canEdit ?? false)) return;
      stateRef.current = event.data.state;
      saver.save(event.data.state);
    };

    const onLoad = (): void => {
      loads += 1;
      if (loads > 1) stop('navigated');
    };
    const onWindowBlur = (): void => {
      setTimeout(check, 0);
    };
    // A press on the board ends the frame's hold on the keyboard.
    const onPressBoard = (): void => {
      guard.release();
      tellEntered(false);
      enteredByKey = false;
      if (holds()) focusBoardHome();
    };
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if ((target instanceof HTMLElement || target instanceof SVGElement) && target.tagName !== 'IFRAME') {
        guard.release();
        tellEntered(false);
        enteredByKey = false;
      }
    };
    const onFocusOut = (event: FocusEvent): void => {
      const target = event.target;
      lastFocusOut = (target instanceof HTMLElement || target instanceof SVGElement) && target.tagName !== 'IFRAME' ? target : null;
    };

    const poll = setInterval(check, FOCUS_POLL_MS);
    const beats = setInterval(() => {
      if (ended || port === null) return;
      if (document.visibilityState === 'hidden') {
        heartbeat.rest();
        return;
      }
      const { verdict, ping } = heartbeat.beat();
      if (verdict === 'stop') {
        stop('silent');
        return;
      }
      if (verdict === 'silent') {
        setSilent(true);
        guard.release();
        tellEntered(false);
        if (holds()) focusBoardHome();
      }
      const message: EmbedBoardMessage = { ping };
      port.postMessage(message);
    }, EMBED_HEARTBEAT_MS);

    const unregister = registerEmbedFrame(id, {
      use() {
        if (ended) return;
        guard.allow(performance.now());
        tellEntered(true);
        enteredByKey = true;
        const active = document.activeElement;
        if ((active instanceof HTMLElement || active instanceof SVGElement) && active.tagName !== 'IFRAME') active.blur();
        node.contentWindow?.focus();
        if (!holds()) node.focus();
      },
    });

    node.addEventListener('load', onLoad);
    window.addEventListener('message', onMessage);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('pointerdown', onPressBoard, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    return () => {
      ended = true;
      unregister();
      clearInterval(poll);
      clearInterval(beats);
      if (looking !== undefined) clearTimeout(looking);
      if (port !== null) {
        port.onmessage = null;
        port.close();
      }
      node.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('pointerdown', onPressBoard, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      saver.flush();
    };
  }, [srcdoc, refusal, stopped, saver, id, html]);

  useEffect(() => {
    if (element.state === stateRef.current || saver.isOwnWrite(element.state)) return;
    stateRef.current = element.state;
    const message: EmbedStateMessage = { boardEmbed: 'state', state: element.state ?? null };
    frame.current?.contentWindow?.postMessage(message, '*');
  }, [element.state, saver]);

  if (refusal !== undefined || stopped !== undefined) return <StoppedEmbed id={id} reason={stopped} refusal={refusal} />;
  return (
    <iframe
      ref={frame}
      className="wb-html-frame"
      title={title}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      referrerPolicy="no-referrer"
      inert={silent}
      {...(silent ? { 'data-wb-silent': '' } : {})}
    />
  );
}
