import { useEffect } from 'react';
import { announce } from '@open-artifact/editor-kit';
import { agentName } from '../stores/working.ts';
import { waitsForYou } from './words.ts';

/** Tells screen readers, each time it starts showing, that the agent waits on the person. */
export function useWaitingAnnouncement(shown: boolean): void {
  useEffect(() => {
    if (shown) announce(waitsForYou(agentName()));
  }, [shown]);
}
