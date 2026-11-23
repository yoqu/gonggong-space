/**
 * The empty board's guidance: one tip about asking the agent, with a small
 * scene acting it out, shown once for the scene's length (plus a moment)
 * or until the person starts; and, while the agent fills an empty board,
 * "The agent is working…" with rotating hints about using the board.
 *
 * What the tips say and how long they show is in `empty-tips.ts`; the
 * scenes are drawn by `tip-scenes.ts`. Viewers and commenters see neither.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isApplePlatform } from '../lib/tools.ts';
import { useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { useBoard } from '../state/board.ts';
import { usePreferences } from '../state/preferences.ts';
import { useCoarsePointer, useMediaQuery } from '../ui/hooks.ts';
import {
  WORKING_HINT_FIRST_DELAY_MS,
  WORKING_HINT_INTERVAL_MS,
  WORKING_HINT_OUT_MS,
  dismissesTip,
  emptyBoardTips,
  pickTip,
  startedLine,
  tipShownMs,
  workingHintLines,
  workingLabel,
  type TipSceneKey,
} from './empty-tips.ts';
import { hasRoom } from './presence.ts';
import { playTipScene } from './tip-scenes.ts';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True once the person clicked or pressed a key (other than focus moves and modifiers) while `enabled`. */
function useFirstInput(enabled: boolean): boolean {
  const [acted, setActed] = useState(false);
  useEffect(() => {
    if (!enabled || acted) return;
    const markActed = (): void => setActed(true);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dismissesTip(event.key)) markActed();
    };
    window.addEventListener('pointerdown', markActed, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', markActed, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled, acted]);
  return acted;
}

/** True once the page has been visible (a tab opened in the background waits to show its tip). */
function useDocumentHasBeenVisible(): boolean {
  const [seen, setSeen] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    if (seen) return;
    const onChange = (): void => {
      if (document.visibilityState !== 'hidden') setSeen(true);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [seen]);
  return seen;
}

/** A tip's scene, playing in its own box. */
function TipScene({ scene, name, mac, rest }: { scene: TipSceneKey; name: string; mac: boolean; rest: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => (host.current === null ? undefined : playTipScene(host.current, scene, { rest, mac, name })), [scene, name, mac, rest]);
  return <div ref={host} data-scene={scene} className="wb-empty-scene" />;
}

interface EmptyBoardTipProps {
  touch: boolean;
  name: string;
  slash: boolean;
  /** Picks the tip (0 ≤ chance < 1), fixed for the page. */
  chance: number;
  /** The tip is going (the person started, or its time is up). */
  gone: boolean;
  onUp: () => void;
  onShown: () => void;
}

/** One tip: shows, plays its scene, and fades once gone. */
function EmptyBoardTip({ touch, name, slash, chance, gone, onUp, onShown }: EmptyBoardTipProps) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    setUp(true);
    onUp();
  }, [onUp]);
  const mac = isApplePlatform();
  const reduced = useMediaQuery(REDUCED_MOTION);
  const tips = emptyBoardTips({ touch, name, mac, slash, embeds: true });
  const [picked] = useState(() => pickTip(tips, chance));
  // The same tip while it still applies (its words may follow the agent's name).
  const current = tips.find((tip) => tip.scene === picked?.scene);
  const scene = (current ?? picked)?.scene;
  // A tip that no longer applies (the screen turned touch) is over at once.
  const shownMs = tipShownMs(current, reduced);
  useEffect(() => {
    const timer = setTimeout(onShown, shownMs);
    return () => clearTimeout(timer);
  }, [shownMs, onShown]);
  const [goneAtMount] = useState(gone);
  const { words, keys } = current ?? picked ?? { words: '' };
  const [before = '', after = ''] = words.split('{}');
  return (
    <>
      <div aria-hidden="true" className="wb-empty-tip" data-up={up && !gone ? '' : undefined}>
        {scene === undefined || goneAtMount ? null : <TipScene scene={scene} name={name} mac={mac} rest={reduced} />}
        <p className="wb-empty-line">
          <span className="wb-empty-label">Tip</span> {before}
          {keys === undefined ? null : (
            <span className="wb-empty-keys">
              {keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          )}
          {after}
        </p>
      </div>
      <p className="sr-only">{startedLine({ touch, name, mac })}</p>
    </>
  );
}

/** The hint index while the agent works: -1 at first, then 0, 1, 2… on a timer. */
function useWorkingHintIndex(): number {
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    let count = -1;
    let timer = setTimeout(function tick() {
      count += 1;
      setIndex(count);
      timer = setTimeout(tick, WORKING_HINT_INTERVAL_MS);
    }, WORKING_HINT_FIRST_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return index;
}

/** "The agent is working…", giving way to hints that fade out and in. */
function EmptyBoardWorking({ touch, name }: { touch: boolean; name: string }) {
  const index = useWorkingHintIndex();
  const label = workingLabel(name);
  const hints = workingHintLines(touch);
  const wanted = index < 0 ? label : (hints[index % hints.length] ?? label);
  const [shown, setShown] = useState(wanted);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (wanted === shown) return;
    setOut(true);
    const timer = setTimeout(() => {
      setShown(wanted);
      setOut(false);
    }, WORKING_HINT_OUT_MS);
    return () => clearTimeout(timer);
  }, [wanted, shown]);
  return (
    <div className="wb-empty-busy">
      <p aria-hidden="true" className="wb-shimmer wb-empty-hint" data-out={out ? '' : undefined}>
        {shown}
      </p>
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  );
}

interface EmptyBoardStateProps {
  /** No tip has shown yet. */
  fresh: boolean;
  /** The tip is up. */
  begun: boolean;
  gone: boolean;
  chance: number;
  onUp: () => void;
  onShown: () => void;
}

/** The tip while the agent can be asked, or the working line while it works. */
function EmptyBoardState({ fresh, begun, gone, chance, onUp, onShown }: EmptyBoardStateProps) {
  const available = useAgent((state) => state.available);
  const busy = useAgent((state) => state.busy);
  const name = useAgent((state) => state.name);
  // The agent claiming ground (a request in hand) ends the tip.
  const claiming = useBoard((state) => (state.board.content.claimed?.length ?? 0) > 0);
  const touch = useCoarsePointer();
  const letterKeys = usePreferences((state) => state.letterKeys);
  const visible = useDocumentHasBeenVisible();
  useEffect(() => {
    if (claiming && begun) onShown();
  }, [claiming, begun, onShown]);
  if (busy) {
    return (
      <div className="wb-empty">
        <EmptyBoardWorking touch={touch} name={name} />
      </div>
    );
  }
  if (!available) return null;
  return (
    <div className="wb-empty">
      {!(fresh && claiming) && visible ? (
        <EmptyBoardTip touch={touch} name={name} slash={letterKeys && hasRoom()} chance={chance} gone={gone || claiming} onUp={onUp} onShown={onShown} />
      ) : null}
    </div>
  );
}

/** The empty board's tip, or the agent's working line (nothing once the board has content). */
export function EmptyBoard() {
  const empty = useBoard((state) => state.status === 'ready' && state.board.content.elements.length === 0);
  const filled = useBoard((state) => state.status === 'ready' && state.board.content.elements.length > 0);
  const canEdit = maybeSession()?.canEdit ?? false;
  const acted = useFirstInput(canEdit);
  const [chance] = useState(Math.random);
  const [phase, setPhase] = useState<'new' | 'up' | 'over'>('new');
  const markUp = useCallback(() => setPhase((current) => (current === 'new' ? 'up' : current)), []);
  const markOver = useCallback(() => setPhase('over'), []);
  // Once the board has had content, the tip is over for good.
  useEffect(() => {
    if (filled) setPhase('over');
  }, [filled]);
  if (!empty || !canEdit) return null;
  return <EmptyBoardState fresh={phase === 'new'} begun={phase === 'up'} gone={acted || phase === 'over'} chance={chance} onUp={markUp} onShown={markOver} />;
}
