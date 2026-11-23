/**
 * Form controls used by inspectors: text, number (with scrubbing), select,
 * switch, slider, segmented control and color.
 */
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { isComposingKey, preventRepeatedActivation } from './keys.ts';
import { POPUP_CLASS } from './menu.tsx';

/**
 * Shared look of single-line inputs. Every field's box also carries `data-ui-field`, so a page can give the fields
 * of one part of it another look (a compact inspector, say).
 */
export const INPUT_CLASS =
  'h-7 w-full min-w-0 rounded-control border border-line bg-surface-2 px-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:bg-surface';

/** A plain text input. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} data-ui-field="" className={cn(INPUT_CLASS, className)} {...rest} />;
});

/** Props of {@link CommitInput}. */
export interface CommitInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  /** Called on Enter or blur, only when the text changed. Returning `false` refuses the text: the field shows `value` again. */
  onCommit: (value: string) => void | boolean;
  /** Called with the draft as it is typed, and with `value` again when Escape puts it back. */
  onDraftChange?: (draft: string) => void;
}

/**
 * A text input that keeps a local draft and commits on Enter or blur; Escape
 * restores the last committed value. Inspector edits use it so every
 * keystroke does not become a document write.
 */
export function CommitInput({ value, onCommit, onDraftChange, className, ...rest }: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  /** Set by Enter and Escape, which already decided: the blur they cause commits nothing more. */
  const settled = useRef(false);
  const commit = () => {
    if (settled.current) {
      settled.current = false;
      return;
    }
    if (draft !== value && onCommit(draft) === false) {
      setDraft(value);
      onDraftChange?.(value);
    }
  };
  return (
    <input
      data-ui-field=""
      className={cn(INPUT_CLASS, className)}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraftChange?.(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isComposingKey(event.nativeEvent)) return;
        if (event.key === 'Enter') {
          commit();
          settled.current = true;
          (event.target as HTMLInputElement).blur();
          settled.current = false;
        } else if (event.key === 'Escape') {
          settled.current = true;
          setDraft(value);
          onDraftChange?.(value);
          (event.target as HTMLInputElement).blur();
          settled.current = false;
        }
      }}
      {...rest}
    />
  );
}

/** Props of {@link NumberInput}. */
export interface NumberInputProps {
  value: number | null;
  /** Live updates while scrubbing or typing. */
  onChange?: (value: number | null) => void;
  /** Final value after typing (blur), scrub release or a step. */
  onCommit: (value: number | null) => void;
  /** Short label drawn in the scrub area, e.g. `W`, `X` or an icon. */
  label?: ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/** A number field whose label can be dragged horizontally to scrub the value. */
export function NumberInput({ value, onChange, onCommit, label, unit, min, max, step = 1, placeholder, className, ...aria }: NumberInputProps) {
  return (
    <BaseNumberField.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => onChange?.(next)}
      onValueCommitted={(next) => onCommit(next)}
      data-ui-field=""
      className={cn('flex h-7 min-w-0 items-center rounded-control border border-line bg-surface-2 focus-within:border-accent', className)}
    >
      {label !== undefined ? (
        <BaseNumberField.ScrubArea className="flex h-full w-6 shrink-0 cursor-ew-resize items-center justify-center text-[11px] text-fg-subtle">
          {label}
          <BaseNumberField.ScrubAreaCursor />
        </BaseNumberField.ScrubArea>
      ) : null}
      <BaseNumberField.Input
        placeholder={placeholder}
        aria-label={aria['aria-label']}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className={cn('h-full w-full min-w-0 bg-transparent text-[13px] text-fg outline-none', label === undefined && 'pl-2')}
      />
      {unit ? <span className="pr-2 text-[11px] text-fg-subtle">{unit}</span> : null}
    </BaseNumberField.Root>
  );
}

/** One option of {@link SelectInput} and {@link Segmented}. */
export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  /** Icon-only segments need an accessible name. */
  title?: string;
}

/** Props of {@link SelectInput}. */
export interface SelectInputProps<T extends string> {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/** A dropdown select. */
export function SelectInput<T extends string>({ value, options, onChange, placeholder = '—', className, ...aria }: SelectInputProps<T>) {
  return (
    <BaseSelect.Root value={value} onValueChange={(next) => next !== null && onChange(next as T)}>
      <BaseSelect.Trigger
        aria-label={aria['aria-label']}
        data-ui-field=""
        className={cn(INPUT_CLASS, 'flex items-center justify-between gap-1 text-left', className)}
      >
        <BaseSelect.Value>
          {(current: T | null) => options.find((option) => option.value === current)?.label ?? <span className="text-fg-subtle">{placeholder}</span>}
        </BaseSelect.Value>
        <BaseSelect.Icon>
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-[1000]" alignItemWithTrigger={false}>
          <BaseSelect.Popup className={cn(POPUP_CLASS, 'max-h-80 overflow-auto')}>
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className="flex h-7 min-w-32 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-hover"
                >
                  <span className="flex size-4 items-center justify-center">
                    <BaseSelect.ItemIndicator>
                      <Check className="size-3.5" />
                    </BaseSelect.ItemIndicator>
                  </span>
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
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
  /**
   * Called with the picked option when it is pressed again (to let the pick go, say). Without it, that press does
   * nothing and the pick stays.
   */
  onRepick?: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

/** A segmented control (one of a few options, all visible). */
export function Segmented<T extends string>({ value, options, onChange, onRepick, className, ...aria }: SegmentedProps<T>) {
  return (
    <ToggleGroup
      value={value === null ? [] : [value]}
      onValueChange={(next) => {
        const picked = next[0];
        // Pressing the pressed option again leaves the group empty.
        if (picked !== undefined) onChange(picked as T);
        else if (value !== null) onRepick?.(value);
      }}
      aria-label={aria['aria-label']}
      data-ui-field=""
      className={cn('flex h-7 items-center gap-0.5 rounded-control bg-surface-2 p-0.5', className)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={option.title}
          title={option.title}
          className="flex h-full flex-1 items-center justify-center whitespace-nowrap rounded-[4px] px-1.5 text-fg-muted outline-none hover:text-fg data-[pressed]:bg-surface data-[pressed]:text-fg data-[pressed]:shadow-sm focus-visible:outline-2 focus-visible:outline-accent"
        >
          {option.label}
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

/** An on/off switch. A held Enter flips it once. */
export function SwitchInput({ checked, onChange, disabled, ...aria }: SwitchInputProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next)}
      onKeyDown={preventRepeatedActivation}
      aria-label={aria['aria-label']}
      className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors data-[checked]:bg-accent disabled:opacity-40"
    >
      <BaseSwitch.Thumb className="size-3 rounded-full bg-white shadow transition-transform data-[checked]:translate-x-3" />
    </BaseSwitch.Root>
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
  'aria-label'?: string;
}

/** A horizontal slider. */
export function SliderInput({ value, min, max, step = 1, onChange, onCommit, ...aria }: SliderInputProps) {
  return (
    <BaseSlider.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => onChange(Array.isArray(next) ? (next[0] ?? min) : next)}
      onValueCommitted={(next) => onCommit?.(Array.isArray(next) ? (next[0] ?? min) : next)}
      className="flex h-7 w-full items-center"
    >
      <BaseSlider.Control className="flex h-4 w-full items-center">
        <BaseSlider.Track className="h-1 w-full rounded-full bg-line-strong">
          <BaseSlider.Indicator className="rounded-full bg-accent" />
          <BaseSlider.Thumb aria-label={aria['aria-label']} className="size-3.5 rounded-full border border-line-strong bg-white shadow outline-none focus-visible:outline-2 focus-visible:outline-accent" />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

/** Props of {@link ColorInput}. */
export interface ColorInputProps {
  /** Any CSS color string, or `null` for "not set". */
  value: string | null;
  onCommit: (value: string) => void;
  /** Swatches offered above the text field (e.g. design-system tokens). */
  swatches?: { label: string; value: string; css?: string }[];
  /** Text shown while no color is set (default "none"). */
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * A color field: a swatch opening the browser's picker, a text field for any
 * CSS color (hex, rgb, oklch, `var(--token)`), and optional token swatches.
 */
export function ColorInput({ value, onCommit, swatches, placeholder = 'none', ...aria }: ColorInputProps) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <label
          className="relative size-7 shrink-0 overflow-hidden rounded-control border border-line"
          style={{ background: value ?? 'transparent' }}
          title="Pick a color"
        >
          <input
            type="color"
            value={hex}
            aria-label={aria['aria-label'] ? `${aria['aria-label']} picker` : 'Color picker'}
            onChange={(event) => onCommit(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <CommitInput value={value ?? ''} onCommit={onCommit} placeholder={placeholder} aria-label={aria['aria-label']} />
      </div>
      {swatches && swatches.length ? (
        <div className="flex flex-wrap gap-1">
          {swatches.map((swatch) => (
            <button
              key={swatch.label}
              type="button"
              title={swatch.label}
              aria-label={swatch.label}
              onClick={() => onCommit(swatch.css ?? swatch.value)}
              className="size-5 rounded-[4px] border border-line"
              style={{ background: swatch.value }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
