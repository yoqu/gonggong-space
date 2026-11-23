/** The polite live region screen readers hear (`announce.ts`). Render it once per page. */

import { useAnnouncer } from './announce.ts';

export function Announcer() {
  const message = useAnnouncer((s) => s.message);
  const serial = useAnnouncer((s) => s.serial);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
      {/* A key per announcement: the same words are read again. */}
      <span key={serial}>{message}</span>
    </div>
  );
}
