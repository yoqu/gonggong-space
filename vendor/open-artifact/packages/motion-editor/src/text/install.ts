import { createElement } from 'react';
import { registerStageOverlay } from '../player/overlays.ts';
import { startTextWatch } from './watch.ts';
import { WordOverlay } from './WordOverlay.tsx';

/** The stage's text reports and the buttons over retypable words. */
export function installText(): () => void {
  const stopOverlay = registerStageOverlay({ id: 'text', order: 20, render: (context) => createElement(WordOverlay, context) });
  const stopWatch = startTextWatch();
  return () => {
    stopWatch();
    stopOverlay();
  };
}
