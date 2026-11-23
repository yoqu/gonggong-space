/**
 * Primitives of the editor chrome (Design, Slides and Whiteboard): floating
 * cards (12px radius, hairline ring, soft shadow), 28px / 32px / 36px ghost
 * controls (pressed = blue-soft), icon-only tool buttons, dark tooltips with
 * key chips, menus (14px radius, 28px rows, submenus included), popovers
 * and color swatch rows.
 *
 * Menus and popovers take a `mark` (a `data-*` attribute their popup
 * carries, e.g. so a board surface starts no gesture on it) and a
 * `popupBase` (classes in place of {@link POPUP}) for editors whose popups
 * look different.
 *
 * Styled with the editor's chrome tokens (`bg-chrome`, `text-chrome-fg`,
 * `bg-chrome-hover`, `bg-chrome-pressed`, `text-chrome-accent`,
 * `shadow-chrome`, `bg-tip`…); the focus ring is `outline-chrome-focus`, so
 * each editor picks its own focus color.
 */

import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { Check, ChevronRight } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import type { ChromeDraw, ShellConnection } from '@open-artifact/runtime';
import { cn, swallowFollowUpClicks } from '@open-artifact/ui';
import { menuFit } from './menu-fit.ts';

/** A floating chrome card. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card({ className, ...rest }, ref) {
  return <div ref={ref} className={cn('pointer-events-auto flex items-center gap-1 rounded-[12px] bg-chrome text-chrome-fg shadow-chrome', className)} {...rest} />;
});

/** The 1 × 18px divider between groups of controls (`vertical: false`: a full-width 1px rule between rows). */
export function ChromeDivider({ className, vertical = true }: { className?: string; vertical?: boolean }): ReactNode {
  return <div aria-hidden="true" className={cn(vertical ? 'mx-0.5 h-[18px] w-px' : 'my-1 h-px w-full', 'shrink-0 bg-chrome-line', className)} />;
}

/** Where a tooltip or popup opens. */
export type ChromeSide = 'top' | 'bottom' | 'left' | 'right';

/** A `data-*` attribute a popup carries (see the module comment). */
export type ChromeMark = `data-${string}`;

/** The props that put `mark` on an element. */
const marked = (mark: ChromeMark | undefined): Record<string, string> => (mark ? { [mark]: '' } : {});

/** A dark tooltip; the shortcut shows as a key chip. */
export function Tip({
  label,
  shortcut,
  side = 'bottom',
  children,
  disabled,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: ChromeSide;
  /** Never open (e.g. while a popup of the trigger is open). */
  disabled?: boolean;
  children: ReactElement<Record<string, unknown>>;
}): ReactNode {
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={8} className="z-[1000]">
          <BaseTooltip.Popup className="flex max-w-80 items-center gap-1.5 rounded-[6px] bg-tip px-2 py-[5px] text-[13px] leading-[18px] text-tip-fg shadow-[0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgb(11_11_11/0.08)] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <span>{label}</span>
            {shortcut ? <kbd className="rounded-[4px] bg-white/15 px-1 font-sans text-[12px] leading-4 text-tip-fg/80">{shortcut}</kbd> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/** Shares hover delays between neighbouring tooltips. */
export function TipGroup({ children }: { children: ReactNode }): ReactNode {
  return (
    <BaseTooltip.Provider delay={400} closeDelay={0}>
      {children}
    </BaseTooltip.Provider>
  );
}

/** Props of {@link ChromeButton}. */
export interface ChromeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Pressed state (tools, toggles). */
  pressed?: boolean;
  /** Icon-only: a square control. */
  square?: boolean;
  /** Control height: 28px (cards), 32px (bottom toolbars) or 36px (a board's tool bar). */
  size?: 'md' | 'lg' | 'xl';
}

const HEIGHTS = { md: 'h-7', lg: 'h-8', xl: 'h-9' } as const;
const WIDTHS = { md: 'w-7', lg: 'w-8', xl: 'w-9' } as const;

/** A ghost control: 8px radius, 14px text, blue-soft when pressed. */
export const ChromeButton = forwardRef<HTMLButtonElement, ChromeButtonProps>(function ChromeButton(
  { pressed, square, size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-1 whitespace-nowrap rounded-[8px] text-[14px] font-control leading-5 text-chrome-fg outline-none transition-colors duration-100 ease-out',
        'hover:bg-chrome-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus',
        'disabled:pointer-events-none disabled:opacity-40',
        HEIGHTS[size],
        square ? WIDTHS[size] : 'px-[9px]',
        pressed && 'bg-chrome-pressed text-chrome-pressed-fg hover:bg-chrome-pressed',
        className,
      )}
      {...rest}
    />
  );
});

/** A {@link ChromeButton} with a tooltip that still shows while it is disabled. */
export const TipButton = forwardRef<HTMLButtonElement, ChromeButtonProps & { tip: ReactNode; shortcut?: string; side?: ChromeSide }>(function TipButton(
  { tip, shortcut, side, disabled, ...rest },
  ref,
) {
  const button = <ChromeButton ref={ref} disabled={disabled} {...rest} />;
  // A disabled button gets no pointer events, so the tooltip hangs on a wrapper.
  return (
    <Tip label={tip} shortcut={shortcut} side={side}>
      {disabled ? <span className="inline-flex">{button}</span> : button}
    </Tip>
  );
});

/** Props of {@link ToolButton}. */
export interface ToolButtonProps extends Omit<ChromeButtonProps, 'children' | 'square'> {
  /** Accessible name and tooltip text. */
  label: string;
  /** Longer tooltip text, when it differs from the name. */
  tip?: ReactNode;
  icon: ReactNode;
  shortcut?: string;
  tipSide?: ChromeSide;
}

/** A square, icon-only control with a tooltip (36px by default; its icon drawn at 18px). */
export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { label, tip, icon, shortcut, tipSide = 'top', size = 'xl', className, ...rest },
  ref,
) {
  return (
    <Tip label={tip ?? label} shortcut={shortcut} side={tipSide}>
      <ChromeButton ref={ref} square size={size} aria-label={label} className={cn('[&_svg]:size-[18px] [&_svg]:shrink-0', className)} {...rest}>
        {icon}
      </ChromeButton>
    </Tip>
  );
});

/* ---------------------------------- menus --------------------------------- */

/** Classes of a chrome menu's popup. */
export const POPUP =
  'min-w-[128px] max-w-[320px] rounded-[14px] bg-chrome p-1.5 text-[14px] leading-5 font-control text-chrome-fg shadow-chrome-popup outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0';
const ITEM =
  'flex h-7 cursor-default select-none items-center gap-2 rounded-[8px] px-2.5 outline-none data-[highlighted]:bg-chrome-hover data-[popup-open]:bg-chrome-hover data-[disabled]:opacity-40';

/** A chrome menu. `trigger` is rendered as the menu's trigger. */
export function ChromeMenu({
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  className,
  tip,
  open,
  onOpenChange,
  sideOffset = 6,
  mark,
  popupBase = POPUP,
}: {
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  side?: ChromeSide;
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** Tooltip of the trigger. */
  tip?: { label: ReactNode; shortcut?: string; side?: ChromeSide };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Gap between the trigger and the popup (default 6px). */
  sideOffset?: number;
  /** A `data-*` attribute the popup carries. */
  mark?: ChromeMark;
  /** Popup classes in place of {@link POPUP}. */
  popupBase?: string;
}): ReactNode {
  const triggerElement = <BaseMenu.Trigger render={trigger} />;
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      {tip ? (
        <Tip label={tip.label} shortcut={tip.shortcut} side={tip.side ?? (side === 'top' ? 'top' : 'bottom')}>
          {triggerElement}
        </Tip>
      ) : (
        triggerElement
      )}
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset} className="z-[1000]">
          <BaseMenu.Popup {...marked(mark)} className={cn(popupBase, className)} style={menuFit(className)}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/** Props of {@link ChromeMenuItem}. */
export interface ChromeMenuItemProps {
  children: ReactNode;
  /** A second, muted line under the label. */
  description?: ReactNode;
  /** Keep the menu open after a click (default: close). */
  closeOnClick?: boolean;
  onSelect?: () => void;
  shortcut?: string;
  /** Shows a check column; `true` draws the mark. */
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  title?: string;
}

/** One menu row. A row that closes the menu keeps the rest of a double click from reaching what the menu uncovers. */
export function ChromeMenuItem({ children, onSelect, shortcut, checked, disabled, danger, icon, title, description, closeOnClick }: ChromeMenuItemProps): ReactNode {
  return (
    <BaseMenu.Item
      className={cn(ITEM, description !== undefined && 'h-auto min-h-7 items-start py-1.5', danger && 'text-danger data-[highlighted]:bg-danger data-[highlighted]:text-white')}
      disabled={disabled}
      onClick={(event) => {
        if (closeOnClick !== false) swallowFollowUpClicks(event.nativeEvent);
        onSelect?.();
      }}
      closeOnClick={closeOnClick}
      title={title}
    >
      {checked !== undefined ? (
        <span className="flex size-4 shrink-0 items-center justify-center">{checked ? <Check className="size-4 text-chrome-accent" strokeWidth={2.25} /> : null}</span>
      ) : null}
      {icon ? <span data-chrome-icon="" className="flex size-4 shrink-0 items-center justify-center text-chrome-muted">{icon}</span> : null}
      {description !== undefined ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{children}</span>
          <span className="truncate text-[12px] leading-4 text-chrome-muted">{description}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{children}</span>
      )}
      {shortcut ? <span className="ml-6 max-w-40 shrink-0 truncate text-[13px] text-chrome-muted">{shortcut}</span> : null}
    </BaseMenu.Item>
  );
}

/** A submenu row and its popup. */
export function ChromeSubmenu({
  label,
  icon,
  children,
  disabled,
  className,
  mark,
  popupBase = POPUP,
}: {
  label: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  /** Extra classes of the popup. */
  className?: string;
  /** A `data-*` attribute the popup carries. */
  mark?: ChromeMark;
  /** Popup classes in place of {@link POPUP}. */
  popupBase?: string;
}): ReactNode {
  return (
    <BaseMenu.SubmenuRoot>
      <BaseMenu.SubmenuTrigger className={ITEM} disabled={disabled}>
        {icon ? <span data-chrome-icon="" className="flex size-4 shrink-0 items-center justify-center text-chrome-muted">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
      </BaseMenu.SubmenuTrigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} className="z-[1000]">
          <BaseMenu.Popup {...marked(mark)} className={cn(popupBase, className)} style={menuFit(className)}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.SubmenuRoot>
  );
}

/** A menu separator. */
export function ChromeMenuSeparator(): ReactNode {
  return <BaseMenu.Separator className="mx-2.5 my-1 h-px bg-chrome-line" />;
}

/** A muted group label inside a menu. */
export function ChromeMenuLabel({ children }: { children: ReactNode }): ReactNode {
  return <div className="px-2.5 py-1 text-[13px] font-medium text-chrome-muted">{children}</div>;
}

/* --------------------------------- popovers -------------------------------- */

/** Props of {@link ChromePopover}. */
export interface ChromePopoverProps {
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  side?: ChromeSide;
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean, details: ChromePopoverChange) => void;
  className?: string;
  /** Accessible name of the popup. */
  label?: string;
  /** Element the popup is positioned against instead of the trigger. */
  anchor?: Element | null | (() => Element | null);
  /** Gap between the anchor and the popup (default 8px). */
  gap?: number;
  /** Move focus into the popup when it opens (default: true). */
  initialFocus?: boolean;
  /** A `data-*` attribute the popup carries. */
  mark?: ChromeMark;
  /** Popup classes in place of {@link POPUP}. */
  popupBase?: string;
  style?: CSSProperties;
  /**
   * Once something has been typed into a field of the popup (other than a
   * search field), a press outside no longer closes it: Escape, or the
   * popup's own buttons, do.
   */
  holdWhileTyped?: boolean;
}

/** Why a {@link ChromePopover} opens or closes; `cancel()` keeps it as it is. */
export type ChromePopoverChange = BasePopover.Root.ChangeEventDetails;

/** True for a field whose typing is a search (a filter, not an edit worth keeping). */
function isSearchField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (!target.matches('input, textarea, [contenteditable="true"]')) return true;
  return target.matches('[type="search"], [role="searchbox"], [role="combobox"]');
}

/** A floating chrome panel anchored to a trigger (or to `anchor`). A press outside that closes it does not double-click what is under it. */
export function ChromePopover({
  trigger,
  children,
  side = 'top',
  align = 'center',
  open,
  onOpenChange,
  className,
  label,
  anchor,
  gap = 8,
  initialFocus = true,
  mark,
  popupBase = POPUP,
  style,
  holdWhileTyped = false,
}: ChromePopoverProps): ReactNode {
  const typed = useRef(false);
  const change = (next: boolean, details: ChromePopoverChange) => {
    if (!next && details.reason === 'outside-press') {
      if (holdWhileTyped && typed.current) {
        details.cancel();
        return;
      }
      if (details.event instanceof MouseEvent) swallowFollowUpClicks(details.event);
    }
    onOpenChange?.(next, details);
  };
  return (
    <BasePopover.Root
      open={open}
      onOpenChange={change}
      onOpenChangeComplete={(done) => {
        if (!done) typed.current = false;
      }}
    >
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={gap} anchor={anchor ?? undefined} className="z-[1000]">
          <BasePopover.Popup
            {...marked(mark)}
            aria-label={label}
            initialFocus={initialFocus ? undefined : false}
            className={cn(popupBase, className)}
            style={style}
            onInput={(event) => {
              if (!isSearchField(event.target)) typed.current = true;
            }}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/* --------------------------------- swatches -------------------------------- */

/** One color choice of a {@link SwatchRow}. */
export interface Swatch {
  /** The value stored (a palette name or `#rrggbb`). */
  name: string;
  /** CSS color drawn. */
  value: string;
  label: string;
}

/** A row of round color swatches (radio semantics); the current one is ringed in the chrome accent. */
export function SwatchRow({
  label,
  swatches,
  current,
  onPick,
  size = 20,
  className,
}: {
  label: string;
  swatches: readonly Swatch[];
  current: string | undefined;
  onPick: (name: string) => void;
  /** Diameter of a swatch, px (its hit area is 8px larger). */
  size?: number;
  className?: string;
}): ReactNode {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex items-center gap-1', className)}>
      {swatches.map((swatch) => {
        const on = swatch.name === current;
        return (
          <Tip key={swatch.name} label={swatch.label} side="top">
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={swatch.label}
              onClick={() => onPick(swatch.name)}
              className="grid shrink-0 place-items-center rounded-full outline-none transition-shadow focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-chrome-focus"
              style={{ width: size + 8, height: size + 8 }}
            >
              <span
                className={cn('block rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15', on && 'ring-2 ring-chrome-accent ring-offset-2 ring-offset-chrome')}
                style={{ width: size, height: size, background: swatch.value }}
              />
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

/**
 * Whether the Shell framing the page draws `draw` (its save state, its export formats): the page then hides its own
 * copy, so there is one of each. False outside a Shell and for Shells older than `draws`.
 */
export function useShellDraw(shell: ShellConnection | null | undefined, draw: ChromeDraw): boolean {
  const [draws, setDraws] = useState(() => shell?.draws.has(draw) ?? false);
  useEffect(() => {
    if (!shell) return undefined;
    setDraws(shell.draws.has(draw));
    return shell.onHello((next) => setDraws(next.has(draw)));
  }, [shell, draw]);
  return draws;
}
