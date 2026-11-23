/**
 * A right-click menu around any element, built on Base UI's context menu.
 * Items are the UI kit's menu items (they share Base UI's menu parts).
 */

import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import type { HTMLAttributes, ReactNode } from 'react';
import { POPUP_CLASS } from '@open-artifact/ui';

/** Props of {@link ContextMenu}. */
export interface ContextMenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The area that opens the menu on right-click (or long press). */
  children: ReactNode;
  /** Menu items; nothing opens when null. */
  menu: ReactNode | null;
  /** Called as the menu opens (e.g. to select what was right-clicked). */
  onOpen?: () => void;
}

/** Wraps `children` in an area with a context menu. */
export function ContextMenu({ children, menu, onOpen, ...rest }: ContextMenuProps): ReactNode {
  if (!menu) return <div {...rest}>{children}</div>;
  return (
    <BaseContextMenu.Root onOpenChange={(open) => open && onOpen?.()}>
      <BaseContextMenu.Trigger {...rest}>{children}</BaseContextMenu.Trigger>
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className="z-[1000]">
          <BaseContextMenu.Popup className={POPUP_CLASS}>{menu}</BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
