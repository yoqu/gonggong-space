/**
 * The bridge to an Open Artifact Shell framing this page
 * (`createShellBridge`, `@open-artifact/editor-kit`).
 *
 * Several parts of the board own a piece of the Shell's report (sync owns
 * `saved`, collaboration owns `comments`, export owns `formats`), so each
 * sets its part with {@link setShellReport}; commands fan out to every
 * handler added with {@link onShellCommand}. Outside a Shell every call is
 * a no-op and {@link useShellDraws} reports nothing drawn, so the page draws
 * its own controls.
 */

import { createShellBridge } from '@open-artifact/editor-kit';
import { maybeSession } from './session.ts';

export const { useShellDraws, setShellReport, onShellCommand, startShell } = createShellBridge(() => maybeSession()?.shell);
