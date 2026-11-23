/**
 * The controls floating over the stage (or the grid and canvas views): the
 * Add slide / View card at the top-left when the rail does not show it, the
 * Present / properties / zoom card at the top-right, and, while
 * a slide is on stage, the insert toolbar at the bottom and the text format
 * strip next to the selected text.
 *
 * The layer itself lets pointer events through; only the cards take them.
 */

import { type ReactNode } from 'react';
import { useDeck } from '../state/deck.ts';
import { useAgent } from '../services/agent.ts';
import { canChange } from '../services/commands.ts';
import { EndCard } from './EndCard.tsx';
import { FormatBar } from './FormatBar.tsx';
import { TextLinkCard } from './TextLinkCard.tsx';
import { FootToolbar } from './FootToolbar.tsx';
import { FollowingPill, PresenceCard } from './Presence.tsx';
import { StartCard } from './StartCard.tsx';

/** Gap between the floating cards and the stage's edges, px. */
export const CHROME_INSET = 12;

/** Height of the top cards and the bottom toolbar, px. */
export const CHROME_CARD = 40;

/** Room the top cards take from the stage (inset, card, gap), px. */
export const CHROME_TOP = CHROME_INSET + CHROME_CARD + 8;

/** Room the bottom toolbar takes from the stage (gap, toolbar, inset), px. */
export const CHROME_BOTTOM = 8 + CHROME_CARD + CHROME_INSET;

/** Props of {@link StageChrome}. */
export interface StageChromeProps {
  /** A slide is on stage (the bottom toolbar and the zoom show). */
  onStage: boolean;
  /** Show the Add slide / View card (the rail is hidden or another view is up). */
  startCard: boolean;
}

/** The floating layer. */
export function StageChrome({ onStage, startCard }: StageChromeProps): ReactNode {
  const readOnly = useDeck((s) => s.readOnly);
  const agentAvailable = useAgent((s) => s.status.available);
  const editing = !readOnly && canChange();
  return (
    <>
      {startCard ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex">
          <StartCard />
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex gap-2">
        <PresenceCard />
        <EndCard onStage={onStage} />
      </div>
      <FollowingPill />
      {onStage ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
            <FootToolbar editing={editing} ask={agentAvailable && !readOnly} />
          </div>
          <FormatBar />
          <TextLinkCard />
        </>
      ) : null}
    </>
  );
}
