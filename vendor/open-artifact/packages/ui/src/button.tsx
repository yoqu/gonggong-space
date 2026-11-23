import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { Tooltip } from './tooltip.tsx';
import { withRepeatGuard } from './keys.ts';

/** Visual weight of a button. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Height of a button: `sm` 24px, `md` 28px, `lg` 32px. */
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-fg border border-line hover:bg-hover',
  ghost: 'bg-transparent text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-xs gap-1',
  md: 'h-7 px-2.5 text-[13px] gap-1.5',
  lg: 'h-8 px-3 text-[13px] gap-2',
};

/** Props of {@link Button}. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon shown before the label. */
  icon?: ReactNode;
}

/** A text button. A held Enter presses it once. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', onKeyDown, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-medium transition-[background,filter]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
      onKeyDown={withRepeatGuard(onKeyDown)}
    >
      {icon}
      {children}
    </button>
  );
});

/** Props of {@link IconButton}. */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also the tooltip text. Required: icon-only buttons need a name. */
  label: string;
  /** The icon (a lucide component element). */
  icon: ReactNode;
  /** Keyboard shortcut shown in the tooltip, e.g. `⌘Z`. */
  shortcut?: string;
  /** Pressed state for toggle buttons (sets `aria-pressed`). */
  active?: boolean;
  size?: ButtonSize;
  /** Hide the tooltip (for buttons inside menus). */
  noTooltip?: boolean;
}

const ICON_SIZES: Record<ButtonSize, string> = { sm: 'size-6', md: 'size-7', lg: 'size-8' };

/** A square icon-only button with a tooltip. A held Enter presses it once. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, shortcut, active, size = 'md', noTooltip, className, type = 'button', onKeyDown, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors',
        'hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        ICON_SIZES[size],
        className,
      )}
      {...rest}
      onKeyDown={withRepeatGuard(onKeyDown)}
    >
      {icon}
    </button>
  );
  if (noTooltip) return button;
  return <Tooltip label={label} shortcut={shortcut}>{button}</Tooltip>;
});
