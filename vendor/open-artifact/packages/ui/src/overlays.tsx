/**
 * Popover and dialog wrappers.
 */
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from './button.tsx';
import { cn } from './cn.ts';
import { preventRepeatedActivation } from './keys.ts';
import { POPUP_CLASS } from './menu.tsx';

/** Props of {@link Popover}. */
export interface PopoverProps {
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** A floating panel anchored to a trigger, on any of its four sides. A held Enter opens it once. */
export function Popover({ trigger, children, side = 'bottom', align = 'center', open, onOpenChange, className }: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <BasePopover.Trigger render={trigger} onKeyDown={preventRepeatedActivation} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={8} className="z-[1000]">
          <BasePopover.Popup className={cn(POPUP_CLASS, 'p-3', className)}>{children}</BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** Props of {@link Dialog}. */
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Footer buttons; defaults to none. */
  footer?: ReactNode;
  className?: string;
}

/** A modal dialog. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-[900] bg-black/30 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <BaseDialog.Popup
          className={cn(
            'fixed left-1/2 top-1/2 z-[901] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-5 text-fg shadow-popup outline-none',
            'transition-[opacity,transform] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            className,
          )}
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="flex-1">
              <BaseDialog.Title className="text-[15px] font-semibold">{title}</BaseDialog.Title>
              {description ? <BaseDialog.Description className="mt-1 text-fg-muted">{description}</BaseDialog.Description> : null}
            </div>
            <BaseDialog.Close aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-hover">
              <X className="size-4" />
            </BaseDialog.Close>
          </div>
          {children}
          {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Props of {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** A yes/no dialog. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', danger, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
