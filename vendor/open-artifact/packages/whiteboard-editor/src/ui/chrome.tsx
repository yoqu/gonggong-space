/**
 * The board chrome: the shared chrome primitives of
 * `@open-artifact/editor-kit/react`, with the board's own defaults.
 *
 * - Cards, menus and popovers carry `data-wb-chrome`, so the board surface
 *   never starts a gesture from a press on them.
 * - Popups may be a little wider (360px, never past the viewport), scroll
 *   when taller than the room left, and open 8px from their trigger; a
 *   menu row's icon is drawn at 16px.
 * - A popover something was typed into stays open on a press outside.
 * - Icons inside controls are drawn at 18px.
 */

import { forwardRef, type ComponentProps, type HTMLAttributes } from 'react';
import {
  Card as KitCard,
  ChromeButton as KitChromeButton,
  ChromeMenu as KitChromeMenu,
  ChromePopover as KitChromePopover,
  ChromeSubmenu as KitChromeSubmenu,
  type ChromeButtonProps,
  type ChromeMark,
  type ChromePopoverProps,
} from '@open-artifact/editor-kit/react';
import { cn } from '@open-artifact/ui';

export {
  ChromeDivider,
  ChromeMenuItem,
  ChromeMenuLabel,
  ChromeMenuSeparator,
  SwatchRow,
  Tip,
  TipGroup,
  ToolButton,
  type ChromeButtonProps,
  type ChromeSide,
  type Swatch,
  type ToolButtonProps,
} from '@open-artifact/editor-kit/react';

/** The attribute every piece of board chrome carries. */
const MARK: ChromeMark = 'data-wb-chrome';

/** Popup look of the board's menus and popovers (in place of the kit's `POPUP`). */
export const POPUP =
  'min-w-[128px] max-w-[min(360px,calc(100vw-16px))] max-h-[var(--available-height)] overflow-y-auto overscroll-contain rounded-[14px] bg-chrome p-1.5 text-[14px] leading-5 font-control text-chrome-fg shadow-chrome-popup outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 [&_[data-chrome-icon]_svg]:size-4';

/** A floating chrome card. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(props, ref) {
  return <KitCard ref={ref} data-wb-chrome="" {...props} />;
});

/** A ghost control; its icons are drawn at 18px. */
export const ChromeButton = forwardRef<HTMLButtonElement, ChromeButtonProps>(function ChromeButton({ className, ...rest }, ref) {
  return <KitChromeButton ref={ref} className={cn('[&_svg]:size-[18px] [&_svg]:shrink-0', className)} {...rest} />;
});

/** A chrome menu; the trigger's tooltip opens on the menu's side unless it says otherwise. */
export function ChromeMenu({ side = 'bottom', tip, ...rest }: ComponentProps<typeof KitChromeMenu>) {
  return <KitChromeMenu side={side} tip={tip && { ...tip, side: tip.side ?? side }} sideOffset={8} mark={MARK} popupBase={POPUP} {...rest} />;
}

/** A submenu row and its popup. */
export function ChromeSubmenu(props: ComponentProps<typeof KitChromeSubmenu>) {
  return <KitChromeSubmenu mark={MARK} popupBase={POPUP} {...props} />;
}

/** A floating chrome panel anchored to a trigger; once something is typed into it, a press outside leaves it open. */
export function ChromePopover(props: ChromePopoverProps) {
  return <KitChromePopover mark={MARK} popupBase={POPUP} holdWhileTyped {...props} />;
}
