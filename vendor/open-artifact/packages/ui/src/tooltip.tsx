import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

/** Props of {@link Tooltip}. */
export interface TooltipProps {
  /** Tooltip text. */
  label: ReactNode;
  /** Optional keyboard shortcut, shown dimmed after the label. */
  shortcut?: string;
  /** Where the tooltip opens relative to its trigger. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** The trigger element; it must accept a ref and DOM props. */
  children: ReactElement<Record<string, unknown>>;
}

/** Wraps any element with a hover tooltip. Put one {@link TooltipProvider} near the app root. */
export function Tooltip({ label, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-[1000]">
          <BaseTooltip.Popup className="rounded-md bg-fg px-2 py-1 text-xs text-surface shadow-popup data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity">
            {label}
            {shortcut ? <span className="ml-2 opacity-60">{shortcut}</span> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/** Shares hover delays between neighbouring tooltips. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={500} closeDelay={0}>
      {children}
    </BaseTooltip.Provider>
  );
}
