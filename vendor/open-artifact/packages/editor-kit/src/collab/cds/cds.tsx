import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { clsx as cn } from 'clsx';
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Ellipsis,
  Info,
  MessageCircle,
  Pencil,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';

export { cn };

// ---------- where popups go, light or dark ----------

export interface CdsRoot {
  /** Popups (tooltips, menus) portal here: inside the shadow root, so the CDS styles reach them. */
  container: HTMLElement | null;
  dark: boolean;
}
export const CdsRootContext = createContext<CdsRoot>({ container: null, dark: false });
export const useCdsRoot = () => useContext(CdsRootContext);

// ---------- focus, in a tree that may be a shadow root ----------

/** The focused element in `node`'s tree (its shadow root, or the document), or null. */
export function focusedIn(node: Node): Element | null {
  const root = node.getRootNode() as Document | ShadowRoot;
  const active = root.activeElement ?? null;
  return active && active !== node.ownerDocument?.body ? active : null;
}

/** Whether anything has focus: inside the layer, or on the page around it. */
function focusTaken(root: Document | ShadowRoot): boolean {
  const doc = 'host' in root ? root.host.ownerDocument : root;
  const outer = doc.activeElement;
  if ('host' in root && outer === root.host) return root.activeElement !== null;
  return outer !== null && outer !== doc.body;
}

/**
 * After the current task, unless something took focus meanwhile, focuses the first target still in the page.
 * `root` is the tree the targets live in (taken while the part giving focus back was still attached).
 */
export function returnFocus(root: Document | ShadowRoot, targets: readonly (Element | null | undefined)[]): void {
  queueMicrotask(() => {
    if (focusTaken(root)) return;
    for (const target of targets) {
      if (!(target instanceof HTMLElement) || !target.isConnected) continue;
      target.focus({ preventScroll: true });
      if (root.activeElement === target) return;
    }
  });
}

/** Merges refs (callback or object). */
export function mergeRefs<T>(...refs: (Ref<T> | undefined | null)[]): (value: T | null) => void {
  return value => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value);
      else if (ref) (ref as { current: T | null }).current = value;
    }
  };
}

// ---------- Icon (lucide) ----------

/** The icons this UI draws, by name. `filled` ones are drawn solid, with the stroke in the panel's colour. */
const ICONS = {
  X: { icon: X },
  Check: { icon: Check },
  CheckCircleFilled: { icon: CircleCheck, filled: true },
  DotsHorizontal: { icon: Ellipsis },
  ArrowUp: { icon: ArrowUp },
  Edit: { icon: Pencil },
  Trash: { icon: Trash2 },
  Comment: { icon: MessageCircle },
  Info: { icon: Info },
  WarningCircle: { icon: CircleAlert },
  CommentFilled: { icon: MessageCircle, filled: true },
  CaretDown: { icon: ChevronDown },
} satisfies Record<string, { icon: LucideIcon; filled?: boolean }>;
export type IconName = keyof typeof ICONS;
export type IconSize = 'xs' | 'sm' | 'md' | 'auto';

/** Box size (px at a 16px root) and stroke width (in the 24-unit icon grid) by size; bold thickens it. */
const ICON_SIZES = {
  xs: { px: 12, stroke: 2.25, strong: 2.75 },
  sm: { px: 16, stroke: 1.75, strong: 2.5 },
  md: { px: 20, stroke: 1.6, strong: 2.25 },
} as const;

export function Icon({
  name,
  size = 'auto',
  bold = false,
  className,
  style,
}: {
  name: IconName;
  size?: IconSize;
  bold?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  // `auto` follows the density; this UI is always comfortable.
  const spec = ICON_SIZES[size === 'auto' ? 'md' : size];
  const { icon: Glyph, filled = false } = ICONS[name] as { icon: LucideIcon; filled?: boolean };
  return (
    <span data-cds="Icon" aria-hidden className={className} style={{ fontSize: `calc(${spec.px / 16}rem * var(--cds-rem-scale,1))`, ...style }}>
      <Glyph
        aria-hidden
        focusable={false}
        strokeWidth={bold ? spec.strong : spec.stroke}
        {...(filled ? { fill: 'currentColor', stroke: 'var(--cds-page-bg, Canvas)' } : {})}
      />
    </span>
  );
}

// ---------- Surface (panel) ----------

export const panelClass = (raised: boolean) =>
  `rounded-card bg-surface-2 ${raised ? 'shadow-panel' : 'shadow-panel-sm'} forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText]`;

/** The CSS variables a panel surface sets for what is drawn on it (focus rings sit on its colour). */
export function panelVars(dark: boolean): CSSProperties {
  const glow = (role: 'accent' | 'danger') => `0 0 0 3px color-mix(in srgb, var(--cds-fill-${role}) ${dark ? 40 : 28}%, transparent)`;
  return {
    '--cds-page-bg': 'var(--cds-surface-2)',
    '--cds-focus-shadow': `inset 0 0 0 1px var(--cds-page-bg), 0 0 0 1px var(--cds-fill-accent), ${glow('accent')}`,
    '--cds-focus-shadow-danger': `inset 0 0 0 1px var(--cds-page-bg), 0 0 0 1px var(--cds-fill-danger), ${glow('danger')}`,
  } as CSSProperties;
}

// ---------- Tooltip ----------

const TOOLTIP_POPUP =
  'px-2 rounded-[calc(0.375rem*var(--cds-rem-scale,1))] bg-[var(--cds-tooltip-bg)] text-[var(--cds-tooltip-fg)] shadow-sm dark:shadow-panel-sm print:hidden text-[calc(0.8125rem*var(--cds-rem-scale,1))]/[calc(1.125rem*var(--cds-rem-scale,1))] font-normal origin-[var(--transform-origin)] transition-[opacity,scale] duration-snap ease-snap motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[instant]:duration-0';
const TOOLTIP_SINGLE =
  'inline-flex items-center gap-2 min-h-[calc(1.5rem*var(--cds-rem-scale,1))] max-w-[240px] py-[calc(0.1875rem*var(--cds-rem-scale,1))]';
const TOOLTIP_MULTI = 'flex flex-col gap-0.5 max-w-[240px] whitespace-normal py-1.5';
const SHORTCUT_TEXT = 'text-[calc(0.75rem*var(--cds-rem-scale,1))] [--cds-shortcut-cap-ink:var(--cds-text-muted)] self-start';
const SHORTCUT_GLYPHS: Record<string, string> = { enter: '↵', 'cmd+enter': '⌘↵', escape: 'Esc' };

export function Tooltip({
  content,
  shortcut,
  side = 'top',
  multiline = false,
  disabled = false,
  children,
}: {
  content?: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  multiline?: boolean;
  disabled?: boolean;
  children: ReactElement;
}) {
  const { container } = useCdsRoot();
  if (content === undefined || content === null || content === '' || content === false) return children;
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger delay={300} render={children} />
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner side={side} sideOffset={4} positionMethod="fixed" data-cds="Tooltip" className="data-[anchor-hidden]:invisible">
          <BaseTooltip.Popup className={cn(TOOLTIP_POPUP, multiline ? TOOLTIP_MULTI : TOOLTIP_SINGLE, !shortcut && 'text-balance')}>
            <span className="min-w-0 break-words">{content}</span>
            {shortcut && <span className={SHORTCUT_TEXT}>{SHORTCUT_GLYPHS[shortcut] ?? shortcut}</span>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

// ---------- Button ----------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const FOCUS = 'focus-visible:shadow-focus [&[data-initial-focus]:focus]:shadow-focus';
const FOCUS_DANGER = 'focus-visible:shadow-focus-danger [&[data-initial-focus]:focus]:shadow-focus-danger';
const BUTTON_BASE =
  'cds-reset group/btn relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none cursor-[var(--cds-cursor-interactive)] aria-disabled:cursor-default data-[disabled]:cursor-default border-0 outline-none focus-visible:outline-hidden [&[data-initial-focus]:focus]:outline-hidden rounded h-control font-sans text-body [&:disabled:not([aria-busy])]:opacity-disabled disabled:pointer-events-none transition-shadow duration-fast';
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: `text-on-primary font-medium font-control [--cds-shortcut-cap-ink:currentColor] ${FOCUS}`,
  secondary: `text-primary font-normal font-control aria-pressed:text-accent ${FOCUS}`,
  ghost: `text-primary font-normal font-control aria-pressed:text-accent ${FOCUS}`,
  danger: `text-on-danger font-medium font-control [--cds-shortcut-cap-ink:currentColor] ${FOCUS_DANGER}`,
};
const PAINT_BASE =
  'absolute inset-0 rounded-[inherit] transition-[background-color,box-shadow,color] duration-fast ease-out group-focus-visible/btn:shadow-[inset_0_0_0_1px_var(--cds-page-bg)] group-[[data-initial-focus]:focus]/btn:shadow-[inset_0_0_0_1px_var(--cds-page-bg)]';
const PAINT_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-fill-primary group-hover/btn:bg-fill-primary-hover group-[[aria-haspopup][aria-expanded=true]]/btn:bg-fill-primary-hover',
  secondary: 'bg-fill-secondary group-hover/btn:bg-fill-secondary-hover group-[[aria-haspopup][aria-expanded=true]]/btn:bg-fill-secondary-hover',
  ghost: 'bg-transparent group-hover/btn:bg-fill-ghost-hover group-[[aria-haspopup][aria-expanded=true]]/btn:bg-fill-ghost-hover',
  danger: 'bg-fill-danger group-hover/btn:bg-fill-danger-hover group-[[aria-haspopup][aria-expanded=true]]/btn:bg-fill-danger-hover',
};
const PAINT_PRESSED = 'group-aria-pressed/btn:bg-tint-blue group-hover/btn:group-aria-pressed/btn:bg-tint-blue';
const PAINT_FIELD =
  'shadow-field group-aria-pressed/btn:shadow-field-pressed group-focus-visible/btn:group-aria-pressed/btn:shadow-[inset_0_0_0_1px_var(--cds-page-bg)]';
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  iconOnly?: boolean;
  /** An icon name (drawn at the density's size) or a ready element. */
  icon?: IconName | ReactElement;
  /** Icon-only buttons show their aria-label as a tooltip unless this is false. */
  tooltip?: boolean;
  shortcut?: string;
  busy?: boolean;
  children?: ReactNode;
}

export function Button({
  ref,
  variant = 'secondary',
  iconOnly = false,
  icon,
  tooltip = true,
  shortcut,
  busy = false,
  className,
  children,
  onMouseDown,
  type = 'button',
  ...rest
}: ButtonProps) {
  const solid = variant === 'primary' || variant === 'danger';
  const field = variant === 'secondary';
  const iconEl = typeof icon === 'string' ? <Icon name={icon} /> : icon;
  const button = (
    <button
      ref={ref}
      type={type}
      data-cds="Button"
      data-cds-icon-only={iconOnly || undefined}
      data-cds-ghost={variant === 'ghost' || undefined}
      aria-busy={busy || undefined}
      {...rest}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], iconOnly ? 'aspect-square w-control px-0' : 'px-md', className)}
      onMouseDown={event => {
        onMouseDown?.(event);
        // A double click on a button never selects the text around it.
        if (event.detail > 1) event.preventDefault();
      }}
    >
      <span
        aria-hidden
        className={`absolute -z-[1] rounded-[inherit] ${solid ? 'inset-[0.5px] forced-colors:inset-0' : 'inset-0'} btn-squish`}
      >
        <span
          data-cds-part="paint"
          className={cn(
            PAINT_BASE,
            PAINT_VARIANT[variant],
            PAINT_PRESSED,
            field && PAINT_FIELD,
          )}
        />
      </span>
      <span className="inline-flex min-w-0 items-center gap-1">
        {iconOnly ? (
          iconEl
        ) : (
          <>
            {iconEl && <span className="-ms-1 inline-flex">{iconEl}</span>}
            {children}
          </>
        )}
      </span>
    </button>
  );
  const label = rest['aria-label'];
  return iconOnly && label && tooltip ? (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

// ---------- Menu ----------

const MENU_POPUP =
  'cds-reset draggable-none group/menu-popup relative flex flex-col min-w-[128px] max-w-[320px] max-h-[var(--available-height)] bg-surface-3 shadow-panel text-body font-normal text-primary outline-none focus-visible:outline-hidden rounded-[calc(var(--cds-radius)+var(--cds-menu-gutter,calc(0.25rem*var(--cds-rem-scale,1))))]';
const MENU_SCROLL =
  'relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] border-b-[length:var(--cds-ring-inner)] border-transparent forced-colors:border-b-0 p-[var(--cds-menu-gutter,0.25rem)]';
export const MENU_ITEM =
  'cds-reset flex w-full items-center gap-xs compact:px-2 comfortable:px-2.5 py-[calc((var(--cds-h-control)-var(--cds-leading-body))/2)] rounded text-body font-normal font-control [--cds-shortcut-cap-ink:var(--cds-text-muted)] select-none outline-none focus-visible:outline-hidden data-[disabled]:opacity-disabled data-[disabled]:pointer-events-none data-[disabled]:focus-visible:shadow-focus';
const MENU_ITEM_VARIANT = {
  default: 'text-primary data-[highlighted]:bg-fill-ghost-hover',
  danger:
    'group/menu-danger text-danger data-[highlighted]:bg-fill-danger data-[highlighted]:text-on-danger data-[highlighted]:[--cds-shortcut-cap-ink:currentColor]',
} as const;

export interface MenuItemSpec {
  label: string;
  icon?: IconName;
  variant?: 'default' | 'danger';
  separatorBefore?: boolean;
  /** Drawn at the row's end, muted (the header menu's comment count). */
  trailing?: ReactNode;
  disabled?: boolean;
  /** Why it is disabled (its tooltip and its description to assistive technology). */
  disabledReason?: string;
  onSelect: () => void;
}

export function MenuItems({ items }: { items: readonly MenuItemSpec[] }) {
  return (
    <>
      {items.map((item, i) => (
        <div key={i} className="contents">
          {item.separatorBefore && <BaseMenu.Separator className="compact:mx-2 comfortable:mx-2.5 my-1 h-px bg-border" />}
          <BaseMenu.Item
            className={cn(MENU_ITEM, MENU_ITEM_VARIANT[item.variant ?? 'default'])}
            data-cds-icon-row={item.icon ? '' : undefined}
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            aria-description={item.disabled ? item.disabledReason : undefined}
            onClick={item.onSelect}
          >
            {item.icon && (
              <span className="flex size-icon shrink-0 items-center justify-center">
                <Icon name={item.icon} size="auto" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.trailing != null && <span className="shrink-0 ps-4 text-muted tabular-nums">{item.trailing}</span>}
          </BaseMenu.Item>
        </div>
      ))}
    </>
  );
}

export function MenuPopup({ align = 'center', children }: { align?: 'start' | 'center' | 'end'; children: ReactNode }) {
  const { container } = useCdsRoot();
  const popup = useRef<HTMLDivElement>(null);
  // On close, focus goes back to the trigger unless it already moved on (an edit box took it).
  const finalFocus = () => {
    const el = popup.current;
    const active = el ? focusedIn(el) : null;
    return !(active && el && !el.contains(active));
  };
  return (
    <BaseMenu.Portal container={container}>
      <BaseMenu.Positioner side="bottom" align={align} sideOffset={6} positionMethod="fixed">
        <BaseMenu.Popup ref={popup} finalFocus={finalFocus} data-cds="Menu" className={MENU_POPUP}>
          <div className={MENU_SCROLL}>{children}</div>
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export { BaseMenu as Menu };

// ---------- Avatar ----------

const AVATAR_BASE = 'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-sans font-medium leading-none';
const AVATAR_SIZE = {
  sm: 'size-[var(--cds-avatar-sm)] text-[calc(0.5625rem*var(--cds-rem-scale,1))]',
  md: 'size-[var(--cds-avatar-md)] text-footnote',
} as const;

/** Up to two letters: the first word's and the last word's. */
export function initials(name: string, count: 1 | 2 = 2): string {
  const words = name.trim().split(/\s+/);
  const first = (word: string | undefined) => (word ? ([...word][0] ?? '') : '');
  return (first(words[0]) + (count === 2 && words.length > 1 ? first(words[words.length - 1]) : '')).toLocaleUpperCase() || '?';
}

/** A robot head: the agent's avatar. */
export function RobotGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="60%" height="60%" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5.5" width="10" height="7.5" rx="2" />
      <path d="M8 5.5V3.3" />
      <circle cx="8" cy="2.6" r=".7" fill="currentColor" stroke="none" />
      <circle cx="6.1" cy="8.9" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.9" cy="8.9" r="1" fill="currentColor" stroke="none" />
      <path d="M6.6 11.1h2.8M1.5 8.5v2M14.5 8.5v2" />
    </svg>
  );
}

export function Avatar({
  name,
  variant = 'default',
  size = 'sm',
  className,
}: {
  name: string;
  variant?: 'default' | 'agent';
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      data-cds="Avatar"
      role="img"
      aria-label={name}
      className={cn(AVATAR_BASE, AVATAR_SIZE[size], variant === 'agent' ? 'bg-fill-brand text-on-brand' : 'bg-fill-control text-primary', className)}
    >
      {variant === 'agent' ? <RobotGlyph /> : initials(name)}
    </span>
  );
}

// ---------- Badge (the accent one: the composer's @agent mention) ----------

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      data-cds="Badge"
      className="inline-flex items-center gap-1 align-middle h-control-nested whitespace-nowrap rounded-chip px-sm font-sans text-caption font-medium font-badge leading-[round(1.25em,1px)] shrink-0 bg-tint-blue text-accent"
    >
      <span className="leading-[calc(0.75rem*var(--cds-rem-scale,1))] py-[0.125em] -my-[0.125em]">{children}</span>
    </span>
  );
}

// ---------- Checkbox ----------

const CHECKBOX_ROOT =
  'cds-reset group/cb border-0 outline-none focus-visible:outline-hidden data-[disabled]:opacity-disabled inline-flex gap-xs text-start font-sans text-body font-normal text-primary items-start';
const CHECKBOX_BOX =
  'flex shrink-0 size-[var(--cds-checkbox)] items-center justify-center rounded-[var(--cds-checkbox-radius)] border border-strong bg-transparent group-data-[unchecked]/cb:group-hover/cb:border-stronger group-data-[checked]/cb:bg-fill-accent group-data-[checked]/cb:border-transparent group-data-[indeterminate]/cb:bg-fill-accent group-data-[indeterminate]/cb:border-transparent group-data-[checked]/cb:group-hover/cb:bg-fill-accent-hover group-data-[indeterminate]/cb:group-hover/cb:bg-fill-accent-hover group-data-[disabled]/cb:group-data-[unchecked]/cb:group-hover/cb:border-strong group-focus-visible/cb:shadow-focus mt-[calc((1lh_-_var(--cds-checkbox,1rem))_/_2)]';
const CHECKBOX_GLYPH =
  'text-on-accent [clip-path:inset(0_100%_0_0)] group-data-[checked]/cb:[clip-path:inset(0)] group-data-[indeterminate]/cb:[clip-path:inset(0)]';

export function Checkbox({
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <BaseCheckbox.Root
      data-cds="Checkbox"
      data-size="sm"
      checked={checked}
      disabled={disabled}
      onCheckedChange={value => onCheckedChange(value === true)}
      className={CHECKBOX_ROOT}
    >
      <CheckboxMark />
      <span>{label}</span>
    </BaseCheckbox.Root>
  );
}

/** The checkbox's box and tick, for a parent with `group/cb` that sets data-checked / data-unchecked (a menu's
 * checkbox item). */
export function CheckboxMark() {
  return (
    <span className={CHECKBOX_BOX}>
      <span className={CHECKBOX_GLYPH}>
        <Icon name="Check" size="sm" bold style={{ fontSize: 'var(--cds-checkbox-glyph)' }} />
      </span>
    </span>
  );
}

// ---------- TextArea (bare) / PlainEditor ----------

const supportsFieldSizing = () => typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content') === true;

export interface PlainEditorProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'onSubmit' | 'value'> {
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  /** Enter (or ⌘/Ctrl+Enter); Shift+Enter and Alt+Enter add a line. */
  onSubmit?: (value: string, how: { modifierKey: boolean }) => void;
}

export function PlainEditor({ ref, value, onChange, onSubmit, onKeyDown, rows = 1, className, style, ...rest }: PlainEditorProps) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  // Browsers without `field-sizing: content` grow the box by hand.
  useLayoutEffect(() => {
    const el = own.current;
    if (!el || supportsFieldSizing()) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [value]);
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.currentTarget.readOnly || !onSubmit || event.key !== 'Enter') return;
    const native = event.nativeEvent;
    if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && !native.isComposing) {
      event.preventDefault();
      const el = event.currentTarget;
      const doc = el.ownerDocument;
      if (!(typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, '\n'))) {
        el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
        onChange(el.value);
      }
      return;
    }
    if (event.shiftKey || event.altKey || native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    onSubmit(event.currentTarget.value, { modifierKey: event.metaKey || event.ctrlKey });
  };
  const hasMinHeight = /(^|\s)min-h-/.test(className ?? '');
  return (
    <textarea
      ref={mergeRefs(own, ref)}
      data-cds="PlainEditor"
      rows={rows}
      value={value}
      onChange={event => onChange(event.target.value)}
      onKeyDown={keyDown}
      style={{ ...style, '--cds-textarea-rows': rows } as CSSProperties}
      {...rest}
      className={cn(
        'cds-reset w-full block resize-none border-0 bg-transparent p-0 shadow-none',
        'font-sans text-body text-primary placeholder:text-muted outline-none focus-visible:outline-hidden disabled:opacity-disabled',
        '[field-sizing:content]',
        !hasMinHeight && 'min-h-[calc(var(--cds-textarea-rows)*1lh)]',
        className,
      )}
    />
  );
}

/** The field box comment editors sit in. */
export const FIELD_CLASS =
  'rounded bg-fill-field shadow-field-ring data-[invalid]:shadow-field-invalid px-md py-sm transition duration-fast [&:hover:not(:focus-within):not([data-invalid]):not([data-disabled])]:shadow-field-hover focus-within:shadow-focus data-[invalid]:focus-within:shadow-focus-danger font-sans text-body text-primary forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText] forced-colors:-outline-offset-1 forced-colors:data-[invalid]:outline-2 forced-colors:data-[invalid]:-outline-offset-2';
