import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Check, ChevronRight } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { swallowFollowUpClicks } from './clicks.ts';
import { cn } from './cn.ts';
import { preventRepeatedActivation } from './keys.ts';

/** Shared popup look of menus, popovers and selects. */
export const POPUP_CLASS =
  'rounded-lg bg-surface p-1 text-[13px] text-fg shadow-popup outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0';

const ITEM_CLASS =
  'flex h-7 min-w-40 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40';

/** Props of {@link Menu}. */
export interface MenuProps {
  /** The element that opens the menu (rendered via Base UI's `render`). */
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A dropdown menu. Base UI gives it keyboard navigation and typeahead (a
 * Space typed mid-search is part of the search). A held Enter or Space
 * presses the trigger and each row once.
 */
export function Menu({ trigger, children, side = 'bottom', align = 'start', open, onOpenChange }: MenuProps) {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <BaseMenu.Trigger render={trigger} onKeyDown={preventRepeatedActivation} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={6} className="z-[1000]">
          <BaseMenu.Popup className={POPUP_CLASS}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/** Props of {@link MenuItem}. */
export interface MenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
}

/** One action row. The rest of a double click on it does not reach what the closed menu uncovers. */
export function MenuItem({ children, onSelect, icon, shortcut, disabled, danger }: MenuItemProps) {
  return (
    <BaseMenu.Item
      className={cn(ITEM_CLASS, danger && 'text-danger')}
      disabled={disabled}
      onClick={(event) => {
        swallowFollowUpClicks(event.nativeEvent);
        onSelect?.();
      }}
      onKeyDown={preventRepeatedActivation}
    >
      <span className="flex size-4 items-center justify-center text-fg-muted">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut ? <span className="ml-4 text-xs text-fg-subtle">{shortcut}</span> : null}
    </BaseMenu.Item>
  );
}

/** A toggle row with a check mark. */
export function MenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
  closeOnClick = false,
}: {
  children: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Close the menu on click (for a pick among options rather than a toggle). */
  closeOnClick?: boolean;
}) {
  return (
    <BaseMenu.CheckboxItem className={ITEM_CLASS} checked={checked} closeOnClick={closeOnClick} onCheckedChange={(next) => onCheckedChange(next)} onKeyDown={preventRepeatedActivation}>
      <span className="flex size-4 items-center justify-center">
        <BaseMenu.CheckboxItemIndicator>
          <Check className="size-3.5" />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      <span className="flex-1">{children}</span>
    </BaseMenu.CheckboxItem>
  );
}

/** A thin rule between groups of items. */
export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-1 my-1 h-px bg-line" />;
}

/** A non-interactive heading or note inside a menu. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1 text-xs text-fg-subtle">{children}</div>;
}

/** A nested menu opened from a row. */
export function MenuSubmenu({ label, icon, children }: { label: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <BaseMenu.SubmenuRoot>
      <BaseMenu.SubmenuTrigger className={ITEM_CLASS} onKeyDown={preventRepeatedActivation}>
        <span className="flex size-4 items-center justify-center text-fg-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        <ChevronRight className="size-3.5 text-fg-subtle" />
      </BaseMenu.SubmenuTrigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} className="z-[1000]">
          <BaseMenu.Popup className={POPUP_CLASS}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.SubmenuRoot>
  );
}
