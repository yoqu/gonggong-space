import type { ReactElement, ReactNode } from 'react';

/** A label and its control on one line of a Tweaks section. */
export function PanelRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-14 shrink-0 truncate text-xs text-chrome-muted">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}
