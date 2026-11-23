/**
 * The properties panel's controls, in the editor chrome's look: sections
 * with a 40px header (title, then an optional action such as "+"), rows
 * with a 76px label column, 24px fields on a soft fill, segmented controls,
 * a 16px color well, switches and sliders.
 *
 * They take the same props as the UI kit's inspector controls, so a panel
 * section reads the same whichever look it is drawn with.
 */

import { Collapsible } from '@base-ui/react/collapsible';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Check, ChevronDown, ChevronRight, ChevronUp, RotateCcw, X } from 'lucide-react';
import { Fragment, forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@open-artifact/ui';
import { Tip } from '@open-artifact/editor-kit/react';
import { CornerIcon, CornersIcon, SideIcon, SidesIcon, type CornerName, type SideName } from './icons.tsx';
import { captureNumberScrubPointer, SCRUBBED, useNumberScrubGesture } from '../../lib/number-scrub.ts';

/* --------------------------------- layout --------------------------------- */

/** Props of {@link Section}. */
export interface SectionProps {
  title: ReactNode;
  children?: ReactNode;
  /** Controls at the header's end (a "+" that adds or reveals settings). */
  actions?: ReactNode;
  /** A collapsible section (closed unless `defaultOpen`), with a chevron at the end. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}

/** A titled group of rows; sections after the first get a hairline on top. */
export function Section({ title, children, actions, collapsible = false, defaultOpen = !collapsible }: SectionProps): ReactNode {
  if (collapsible) {
    return (
      <Collapsible.Root defaultOpen={defaultOpen} className="border-t border-chrome-sep first:border-t-0">
        <Collapsible.Trigger className="group flex min-h-10 w-full items-center gap-1 py-2 pl-4 pr-3 text-left outline-none focus-visible:bg-chrome-hover">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-[520] text-chrome-fg">{title}</h3>
          <ChevronRight className="size-4 text-chrome-muted transition-transform group-data-[panel-open]:rotate-90" strokeWidth={1.5} />
        </Collapsible.Trigger>
        <Collapsible.Panel className="flex min-w-0 flex-col pb-2">{children}</Collapsible.Panel>
      </Collapsible.Root>
    );
  }
  return (
    <section className="flex min-w-0 shrink-0 flex-col border-t border-chrome-sep pb-2 first:border-t-0">
      <header className="flex min-h-10 items-center gap-1 py-2 pl-4 pr-3">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-[520] text-chrome-fg">{title}</h3>
        {actions ? <div className="-my-1 flex items-center gap-0.5">{actions}</div> : null}
      </header>
      {children ? <div className="flex min-w-0 flex-col">{children}</div> : null}
    </section>
  );
}

/** Props of {@link Row}. */
export interface RowProps {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Tooltip of the label (where the value comes from, what the row does). */
  tip?: string;
  /** Resets the row's own value; the button shows on hover while it is set. */
  onReset?: () => void;
  /** Name of the reset button (default "Reset {label}"). */
  resetLabel?: string;
}

/** One labelled row: 72px label, then the controls. Rows without a label span both columns. */
export function Row({ label, children, className, tip, onReset, resetLabel }: RowProps): ReactNode {
  if (label === undefined) return <div className={cn('flex min-h-8 min-w-0 flex-wrap items-center gap-1.5 px-4 py-px', className)}>{children}</div>;
  return (
    <div className={cn('group/row grid min-h-8 min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-x-2 py-px pl-4 pr-3', className)}>
      <span className="flex min-w-0 items-center gap-0.5" title={tip}>
        <span className="truncate text-[12px] text-chrome-muted">{label}</span>
        {onReset ? (
          <button
            type="button"
            aria-label={resetLabel ?? `Reset ${typeof label === 'string' ? label : ''}`.trim()}
            title={resetLabel ?? `Reset ${typeof label === 'string' ? label : ''}`.trim()}
            onClick={onReset}
            className="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-chrome-muted opacity-0 outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          >
            <RotateCcw className="size-3" strokeWidth={1.75} />
          </button>
        ) : null}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A small muted note inside the panel. */
export function Note({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <p className={cn('px-4 py-1 text-[12px] leading-[1.45] text-chrome-muted', className)}>{children}</p>;
}

/* --------------------------------- fields --------------------------------- */

/** The look of a 24px field. */
export const FIELD =
  'h-6 min-w-0 rounded-[6px] bg-chrome-field text-[13px] text-chrome-fg outline-none shadow-[inset_0_0_0_1px_var(--chrome-field-ring)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--chrome-field-ring-strong)] focus-within:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)] has-[:disabled]:opacity-50';

const INPUT = cn(FIELD, 'w-full px-2 placeholder:text-chrome-muted focus:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)]');

/** A plain text input. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(INPUT, className)} {...rest} />;
});

/** Props of {@link CommitInput}. */
export interface CommitInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  /** Called on Enter or blur, only when the text changed. */
  onCommit: (value: string) => void;
}

/** A text input that keeps a draft and commits on Enter or blur; Escape reverts. */
export function CommitInput({ value, onCommit, className, ...rest }: CommitInputProps): ReactNode {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className={cn(INPUT, className)}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      {...rest}
    />
  );
}

/**
 * `w-full`, unless the caller's classes set a width: `cn` joins classes
 * without resolving conflicts, so both would apply and CSS order would win.
 */
function fullWidth(className: string | undefined): string {
  return className && /(^|\s)w-/.test(className) ? '' : 'w-full';
}

/** Plain numbers: no grouping separators ("1664", not "1,664"). */
const NUMBER_FORMAT: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 3 };

/** Props of {@link NumberInput}. */
export interface NumberInputProps {
  value: number | null;
  /** Live updates while scrubbing or typing. */
  onChange?: (value: number | null) => void;
  /** Final value after typing (blur), scrub release or a step. */
  onCommit: (value: number | null) => void;
  /** A short label or icon at the start; dragging it scrubs the value. */
  label?: ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  /** Up / down buttons while the field has focus (default true). */
  steppers?: boolean;
  disabled?: boolean;
  /** Tooltip of the field (why it is disabled, what it sets). */
  title?: string;
  /** The placeholder is the value in effect (inherited), drawn like a value. */
  inherited?: boolean;
  'aria-label'?: string;
}






export function NumberInput({ value, onChange, onCommit, label, unit, min, max, step = 1, placeholder, className, steppers = true, disabled, title, inherited = false, ...aria }: NumberInputProps): ReactNode {
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const scrub = useNumberScrubGesture({
    value: value ?? Number.NaN,
    step,
    min,
    max,
    disabled,
    onScrub: (next) => {
      last.current = next;
      setScrubbed(next);
      onChange?.(next);
    },
    onScrubEnd: () => {
      const next = last.current;
      last.current = null;
      setScrubbed(null);
      if (next !== null && next !== value) onCommit(next);
      // The field takes the focus, so its keys (and undo, for this drag) are at hand.
      const field = input.current;
      if (!field || next === null || next === value) return;
      field.setAttribute(SCRUBBED, '');
      field.focus({ preventScroll: true });
    },
  });
  return (
    <BaseNumberField.Root
      value={scrubbed ?? value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      title={title}
      onValueChange={(next) => onChange?.(next)}
      onValueCommitted={(next) => onCommit(next)}
      format={NUMBER_FORMAT}
      className={cn(FIELD, 'group/num relative flex items-center', fullWidth(className), className)}
    >
      {label !== undefined ? (
        <span
          data-scrub=""
          onMouseDown={scrub}
          onPointerDown={captureNumberScrubPointer}
          className={cn(
            'flex h-full shrink-0 cursor-ew-resize items-center text-[11px] text-chrome-muted [&>svg]:size-3.5',
            // A word (“Col 1”) keeps its own width on one line; an icon sits in a square.
            typeof label === 'string' ? 'whitespace-nowrap pl-2 pr-1.5' : 'w-6 justify-center',
          )}
        >
          {label}
        </span>
      ) : null}
      <BaseNumberField.Input
        ref={input}
        placeholder={placeholder}
        aria-label={aria['aria-label']}
        onInput={(event) => event.currentTarget.removeAttribute(SCRUBBED)}
        onBlur={(event) => event.currentTarget.removeAttribute(SCRUBBED)}
        onKeyDown={(event) => {
          // Enter commits what was typed (the field commits on blur), keeping the focus.
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          const input = event.currentTarget;
          input.blur();
          input.focus();
        }}
        className={cn('h-full w-full min-w-0 bg-transparent text-[13px] tabular-nums text-chrome-fg outline-none', inherited ? 'placeholder:text-chrome-secondary' : 'placeholder:text-chrome-muted', label === undefined && 'pl-2')}
      />
      {unit ? <span className="shrink-0 pr-2 text-[12px] text-chrome-muted group-focus-within/num:hidden">{unit}</span> : null}
      {steppers ? (
        <span className="hidden h-full shrink-0 flex-col justify-center pr-0.5 group-focus-within/num:flex [@media(pointer:coarse)]:!hidden">
          <BaseNumberField.Increment tabIndex={-1} aria-label="Increase" className="flex h-2.5 w-4 items-center justify-center rounded-[3px] text-chrome-muted hover:bg-chrome-hover hover:text-chrome-fg">
            <ChevronUp className="size-3" strokeWidth={2} />
          </BaseNumberField.Increment>
          <BaseNumberField.Decrement tabIndex={-1} aria-label="Decrease" className="flex h-2.5 w-4 items-center justify-center rounded-[3px] text-chrome-muted hover:bg-chrome-hover hover:text-chrome-fg">
            <ChevronDown className="size-3" strokeWidth={2} />
          </BaseNumberField.Decrement>
        </span>
      ) : null}
    </BaseNumberField.Root>
  );
}

/** One choice of a {@link SelectInput} or {@link Segmented}. */
export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name / tooltip (icon-only segments need one). */
  title?: string;
  /** Muted text at the item's end (a size, a shortcut). */
  hint?: string;
  /** Style of the item's label (a font previewed in itself). */
  style?: CSSProperties;
  /** Icon before the label. */
  icon?: ReactNode;
  /** A header shown above the first item of each group. */
  group?: string;
  /** Unavailable, with the reason as its tooltip. */
  disabled?: boolean;
  reason?: string;
  /** A separator above this item. */
  separated?: boolean;
}

/** Props of {@link SelectInput}. */
export interface SelectInputProps<T extends string> {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  /** Shown before the value (an icon for the kind of value). */
  icon?: ReactNode;
  /** The trigger's text style (a font previewed in itself). */
  valueStyle?: CSSProperties;
  disabled?: boolean;
  /** Tooltip of the trigger (why it is disabled). */
  title?: string;
  /** The placeholder is the value in effect (inherited), drawn like a value. */
  inherited?: boolean;
  'aria-label'?: string;
}

/** A select whose list looks like the chrome menus. */
export function SelectInput<T extends string>({ value, options, onChange, placeholder = '—', className, icon, valueStyle, disabled, title, inherited = false, ...aria }: SelectInputProps<T>): ReactNode {
  const current = options.find((option) => option.value === value);
  return (
    <BaseSelect.Root value={value} disabled={disabled} onValueChange={(next) => next !== null && onChange(next as T)}>
      <BaseSelect.Trigger
        aria-label={aria['aria-label']}
        title={title}
        className={cn(FIELD, 'flex cursor-default items-center gap-1.5 pl-2 pr-[5px] text-left disabled:opacity-50', fullWidth(className), className)}
      >
        {icon ? <span className="flex shrink-0 text-chrome-muted [&>svg]:size-3.5">{icon}</span> : null}
        <span className={cn('min-w-0 flex-1 truncate', !current && (inherited ? 'text-chrome-secondary' : 'text-chrome-muted'))} style={current ? (valueStyle ?? current.style) : undefined}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-[1000]">
          <BaseSelect.Popup className="max-h-[min(420px,var(--available-height))] min-w-[var(--anchor-width)] overflow-auto rounded-[14px] bg-chrome p-1.5 text-[13px] text-chrome-fg shadow-chrome-popup outline-none">
            <BaseSelect.List>
              {options.map((option, i) => {
                const header = option.group && option.group !== options[i - 1]?.group ? option.group : null;
                return (
                  <Fragment key={option.value}>
                    {option.separated && i > 0 ? <div role="separator" className="mx-2 my-1 h-px bg-chrome-sep" /> : null}
                    {header ? <div className="px-2 pb-1 pt-2 text-[11px] font-[520] text-chrome-muted first:pt-1">{header}</div> : null}
                    <BaseSelect.Item
                      value={option.value}
                      disabled={option.disabled}
                      title={option.disabled ? option.reason : option.title}
                      className="flex min-h-7 cursor-default select-none items-center gap-2 rounded-[8px] py-0.5 pl-2 pr-2.5 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-chrome-hover"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <BaseSelect.ItemIndicator>
                          <Check className="size-4 text-chrome-accent" strokeWidth={2.25} />
                        </BaseSelect.ItemIndicator>
                      </span>
                      {option.icon ? <span className="flex shrink-0 text-chrome-muted [&>svg]:size-4">{option.icon}</span> : null}
                      <BaseSelect.ItemText className="min-w-0 flex-1 truncate" style={option.style}>
                        {option.label}
                      </BaseSelect.ItemText>
                      {option.hint ? <span className="shrink-0 pl-3 text-[12px] tabular-nums text-chrome-muted">{option.hint}</span> : null}
                    </BaseSelect.Item>
                  </Fragment>
                );
              })}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/** Props of {@link Segmented}. */
export interface SegmentedProps<T extends string> {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Stacks the segments vertically (a vertical stack's justify control). */
  vertical?: boolean;
  'aria-label'?: string;
}

/** A row of segments, one pressed. */
export function Segmented<T extends string>({ value, options, onChange, className, vertical = false, ...aria }: SegmentedProps<T>): ReactNode {
  return (
    <ToggleGroup
      value={value === null ? [] : [value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked !== undefined) onChange(picked as T);
      }}
      aria-label={aria['aria-label']}
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn('flex items-center gap-0.5 rounded-[6px] bg-chrome-field p-px', vertical ? 'w-6 flex-col' : 'h-6 w-full', className)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option.title}
          title={option.disabled ? (option.reason ?? option.title) : option.title}
          className="flex h-[22px] min-w-0 flex-1 items-center justify-center rounded-[5px] px-1 text-[12px] in-data-[orientation=vertical]:w-[22px] in-data-[orientation=vertical]:flex-none text-chrome-muted outline-none hover:text-chrome-fg focus-visible:outline-2 focus-visible:outline-chrome-accent data-[disabled]:opacity-35 data-[pressed]:bg-chrome data-[pressed]:text-chrome-fg data-[pressed]:shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.08)] [&>svg]:size-4"
        >
          {option.icon ?? option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** Props of {@link SwitchInput}. */
export interface SwitchInputProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label'?: string;
  disabled?: boolean;
}

/** An on/off switch. */
export function SwitchInput({ checked, onChange, disabled, ...aria }: SwitchInputProps): ReactNode {
  return (
    <BaseSwitch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next)}
      aria-label={aria['aria-label']}
      className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-chrome-selected p-0.5 transition-colors data-[checked]:bg-chrome-accent disabled:opacity-40"
    >
      <BaseSwitch.Thumb className="size-3 rounded-full bg-white shadow transition-transform data-[checked]:translate-x-3" />
    </BaseSwitch.Root>
  );
}

/** Props of {@link CheckboxInput}. */
export interface CheckboxInputProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label'?: string;
  disabled?: boolean;
}

/** A 14px checkbox. */
export function CheckboxInput({ checked, onChange, disabled, ...aria }: CheckboxInputProps): ReactNode {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex size-3.5 shrink-0 items-center justify-center rounded-[4px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-chrome-accent disabled:opacity-40',
        checked ? 'bg-chrome-accent text-white' : 'shadow-[inset_0_0_0_1px_var(--chrome-field-ring-strong)]',
      )}
    >
      {checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </button>
  );
}

/** Props of {@link SliderInput}. */
export interface SliderInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** A horizontal slider. */
export function SliderInput({ value, min, max, step = 1, onChange, onCommit, disabled, ...aria }: SliderInputProps): ReactNode {
  return (
    <BaseSlider.Root
      value={value}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => onChange(Array.isArray(next) ? (next[0] ?? min) : next)}
      onValueCommitted={(next) => onCommit?.(Array.isArray(next) ? (next[0] ?? min) : next)}
      className="flex h-6 w-full items-center px-1 data-[disabled]:opacity-40"
    >
      <BaseSlider.Control className="flex h-4 w-full items-center">
        <BaseSlider.Track className="h-[3px] w-full rounded-full bg-chrome-selected">
          <BaseSlider.Indicator className="rounded-full bg-chrome-accent" />
          <BaseSlider.Thumb
            aria-label={aria['aria-label']}
            className="size-3.5 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_1px_3px_rgb(0_0_0/0.2)] outline-none focus-visible:outline-2 focus-visible:outline-chrome-accent"
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

/* --------------------------------- buttons -------------------------------- */

/** Props of {@link IconButton}. */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: ReactNode;
  shortcut?: string;
  /** Pressed state. */
  active?: boolean;
  /** Accepted for compatibility with the UI kit; panel buttons are 24px. */
  size?: 'sm' | 'md' | 'lg';
  noTooltip?: boolean;
  /**
   * Why the button is disabled. The button then stays hoverable (it is
   * `aria-disabled`, and clicks do nothing) so its tooltip can say why.
   */
  reason?: string;
}

/** A 24px icon button for panel headers and rows. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, shortcut, active, size: _size, noTooltip, reason, disabled, onClick, className, type = 'button', ...rest },
  ref,
) {
  const explained = Boolean(disabled && reason);
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={explained ? undefined : disabled}
      aria-disabled={explained ? true : undefined}
      onClick={explained ? (event) => event.preventDefault() : onClick}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-chrome-secondary outline-none transition-colors hover:bg-chrome-hover hover:text-chrome-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-accent disabled:pointer-events-none disabled:opacity-35 aria-disabled:cursor-default aria-disabled:opacity-35 aria-disabled:hover:bg-transparent [&>svg]:size-4',
        active && 'bg-chrome-selected text-chrome-fg hover:bg-chrome-selected',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
  return noTooltip ? (
    button
  ) : (
    <Tip label={explained ? reason : label} shortcut={explained ? undefined : shortcut} side="top">
      {button}
    </Tip>
  );
});

/* ------------------------------ sides, corners ----------------------------- */

/** Four numbers in CSS order: top, right, bottom, left (or the corners from the top left, clockwise). */
export type Quad = [number, number, number, number];

const SIDE_NAMES: readonly SideName[] = ['top', 'right', 'bottom', 'left'];
const CORNER_NAMES: readonly CornerName[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const SIDE_LABELS = ['Top', 'Right', 'Bottom', 'Left'];
const CORNER_LABELS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
/** Where each part sits in the 2 × 2 grid: sides T R / B L, corners TL TR / BL BR. */
const GRID_ORDER = { sides: [0, 1, 2, 3], corners: [0, 1, 3, 2] } as const;

/** Why the per-part toggle can't fold the fields back into one. */
export const PARTS_DIFFER_REASON = 'The values differ — make them equal to use one field';

/** Props of {@link QuadRow}. */
export interface QuadRowProps {
  label: string;
  kind: 'sides' | 'corners';
  /** The four values, or null while the selection disagrees. */
  values: Quad | null;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Placeholder of the single field while nothing is set. */
  placeholder?: string;
  onCommit: (values: Quad) => void;
  /** Why the per-part toggle is unavailable (a shape strokes all round). */
  toggleDisabledReason?: string;
  onReset?: () => void;
  disabled?: boolean;
  title?: string;
}

/**
 * One value for all four sides (or corners), and a toggle that opens a
 * 2 × 2 grid to set each. While the parts differ the single field reads
 * "Per side" / "Per corner" and the grid can't be folded away.
 */
export function QuadRow({ label, kind, values, unit, min, max, step, placeholder = '0', onCommit, toggleDisabledReason, onReset, disabled, title }: QuadRowProps): ReactNode {
  const differ = values !== null && values.some((v) => v !== values[0]);
  const [open, setOpen] = useState(differ);
  useEffect(() => {
    if (differ) setOpen(true);
  }, [differ]);
  const per = kind === 'sides' ? 'Per side' : 'Per corner';
  const lower = label.toLowerCase();
  const reason = toggleDisabledReason ?? (open && differ ? PARTS_DIFFER_REASON : undefined);
  const labels = kind === 'sides' ? SIDE_LABELS : CORNER_LABELS;
  const single = values === null || differ ? null : values[0];
  return (
    <>
      <Row label={label} tip={title} onReset={onReset}>
        <NumberInput
          aria-label={label}
          value={single}
          placeholder={values === null ? 'Mixed' : differ ? per : placeholder}
          unit={unit}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onCommit={(v) => v !== null && onCommit([v, v, v, v])}
        />
        <IconButton
          label={`${open ? 'Hide' : 'Edit'} ${lower} per ${kind === 'sides' ? 'side' : 'corner'}`}
          icon={kind === 'sides' ? <SidesIcon /> : <CornersIcon />}
          active={open}
          disabled={disabled || reason !== undefined}
          reason={reason}
          onClick={() => setOpen(!open)}
        />
      </Row>
      {open && toggleDisabledReason === undefined ? (
        <div className="grid grid-cols-2 gap-2 py-px pl-[96px] pr-[42px]">
          {GRID_ORDER[kind].map((i) => (
            <NumberInput
              key={i}
              aria-label={`${label} ${labels[i]!.toLowerCase()}`}
              title={labels[i]}
              label={kind === 'sides' ? <SideIcon side={SIDE_NAMES[i]!} /> : <CornerIcon corner={CORNER_NAMES[i]!} />}
              value={values === null ? null : values[i]!}
              placeholder={values === null ? 'Mixed' : placeholder}
              unit={unit}
              min={min}
              max={max}
              step={step}
              steppers={false}
              disabled={disabled}
              onCommit={(v) => {
                const base: Quad = values ? [...values] : [0, 0, 0, 0];
                base[i] = v ?? 0;
                onCommit(base);
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------ popover field ------------------------------ */

/** Props of {@link PanelField}. */
export interface PanelFieldProps {
  /** The panel's title and the field's accessible name. */
  title: string;
  /** What the field shows (a summary of the value). */
  text: string;
  /** A swatch at the field's start (a shadow's color). */
  swatch?: string | null;
  children: ReactNode;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A field that opens a titled panel (a shadow, a filter, a transform):
 * the panel has the title and a close button on top, then its rows.
 */
export function PanelField({ title, text, swatch, children, disabled, open: controlled, onOpenChange }: PanelFieldProps): ReactNode {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (next: boolean): void => {
    setOwn(next);
    onOpenChange?.(next);
  };
  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      <BasePopover.Trigger
        disabled={disabled}
        aria-label={`${title}: ${text}`}
        className={cn(FIELD, 'flex w-full min-w-0 cursor-default items-center gap-1.5 pr-2 text-left disabled:opacity-50 data-[popup-open]:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)]', swatch !== undefined ? 'pl-1' : 'pl-2')}
      >
        {swatch !== undefined ? <span className="size-4 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]" style={{ background: swatch ? `linear-gradient(${swatch}, ${swatch}), ${CHECKERBOARD}` : CHECKERBOARD }} /> : null}
        <span className="min-w-0 flex-1 truncate tabular-nums">{text}</span>
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner side="left" align="start" sideOffset={8} collisionPadding={8} className="z-[1000]">
          <BasePopover.Popup className="w-64 rounded-[14px] bg-chrome pb-2 text-chrome-fg shadow-chrome-popup outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <div className="flex h-11 items-center gap-2 pl-4 pr-2">
              <BasePopover.Title className="min-w-0 flex-1 truncate text-[13px] font-[520]">{title}</BasePopover.Title>
              <BasePopover.Close aria-label="Close" title="Close" className="flex size-7 shrink-0 items-center justify-center rounded-[8px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:outline-2 focus-visible:outline-chrome-accent">
                <X className="size-4" strokeWidth={1.5} />
              </BasePopover.Close>
            </div>
            <div className="flex flex-col">{children}</div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

const CHECKERBOARD = 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px';

/** Props of {@link Button}. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Accepted for compatibility with the UI kit; panel buttons are 28px. */
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
}

/** A panel text button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size: _size, icon, className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-control outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-chrome-accent disabled:pointer-events-none disabled:opacity-40 [&>svg]:size-3.5',
        variant === 'primary' && 'bg-chrome-accent text-white hover:brightness-110',
        variant === 'secondary' && 'text-chrome-fg shadow-[inset_0_0_0_1px_var(--chrome-field-ring-strong)] hover:bg-chrome-hover',
        variant === 'ghost' && 'text-chrome-fg hover:bg-chrome-hover',
        variant === 'danger' && 'text-danger hover:bg-danger/10',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
