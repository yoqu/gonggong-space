import type { ReactElement } from 'react';
import { X } from 'lucide-react';
import { Button } from '@open-artifact/ui';
import { useUi } from '../stores/ui.ts';
import { DISMISS } from './words.ts';

/** Messages that stay over the player until dismissed. */
export function Notices(): ReactElement | null {
  const notices = useUi((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col gap-1 px-3 pt-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-tone={notice.tone}
          className="flex items-center gap-2 rounded-lg border border-chrome-line bg-chrome px-3 py-1.5 text-[13px] data-[tone=error]:border-red-500/50 data-[tone=warning]:border-amber-500/50"
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          {notice.action !== undefined ? (
            <Button size="sm" onClick={notice.action.run}>
              {notice.action.label}
            </Button>
          ) : null}
          <button type="button" aria-label={DISMISS} className="rounded p-0.5 text-chrome-muted hover:bg-chrome-hover" onClick={() => useUi.getState().dismissNotice(notice.id)}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
