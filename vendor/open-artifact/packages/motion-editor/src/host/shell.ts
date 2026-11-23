/**
 * The bridge to a Shell framing this page. Each part of the page sets its own part of the report (live sync owns
 * `saved`, `leaveLosesWork` and `hasContent`; comments own `comments`); commands fan out to every handler. Outside a
 * Shell every call is a no-op.
 */

import { createShellBridge } from '@open-artifact/editor-kit';
import { maybeSession } from './session.ts';

export const { useShellDraws, setShellReport, onShellCommand, startShell } = createShellBridge(() => maybeSession()?.shell);
