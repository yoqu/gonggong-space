/**
 * Entry of `support.js`, the board runtime loaded by every artboard.
 *
 * Besides starting the board, it shares its React as `window.React` and
 * `window.ReactDOM`. A design-system bundle loaded after `support.js`
 * (`<script src="./ds/<folder>/components/bundle.js">`) builds its components
 * with that same React, so `<x-import>` can render them: two copies of React
 * in one tree break hooks.
 */

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { startBoardRuntime } from './board.tsx';

declare global {
  interface Window {
    React?: unknown;
    ReactDOM?: unknown;
  }
}

window.React ??= React;
window.ReactDOM ??= ReactDOM;

startBoardRuntime();
