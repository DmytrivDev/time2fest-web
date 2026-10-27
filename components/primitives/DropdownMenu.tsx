'use client';

import { DropdownMenu as Radix } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

/** P16. Меню дій: «Ще дії чату» (тихий режим, правила), дії повідомлення на десктопі. Пункти ≥ 44 px. */
export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;
export const DropdownMenuGroup = Radix.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  style,
  ...rest
}: ComponentProps<typeof Radix.Content>) {
  return (
    <Radix.Portal>
      <Radix.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        style={{ maxHeight: 'var(--radix-dropdown-menu-content-available-height)', ...style }}
        className={cn(
          'z-30 min-w-56 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 text-body text-text shadow-overlay',
          className,
        )}
        {...rest}
      />
    </Radix.Portal>
  );
}

const ITEM =
  't2f-focus relative flex min-h-touch-min cursor-default select-none items-center gap-3 rounded-md px-3 text-body outline-none data-disabled:text-text-muted data-highlighted:bg-border';

export function DropdownMenuItem({ className, ...rest }: ComponentProps<typeof Radix.Item>) {
  return <Radix.Item className={cn(ITEM, className)} {...rest} />;
}

export function DropdownMenuCheckboxItem({ className, children, ...rest }: ComponentProps<typeof Radix.CheckboxItem>) {
  return (
    <Radix.CheckboxItem className={cn(ITEM, 'pl-8', className)} {...rest}>
      <Radix.ItemIndicator className="absolute left-3 inline-flex">
        <Icon name="check" size={16} />
      </Radix.ItemIndicator>
      {children}
    </Radix.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...rest }: ComponentProps<typeof Radix.Label>) {
  return <Radix.Label className={cn('px-3 py-2 text-caption text-text-muted', className)} {...rest} />;
}

export function DropdownMenuSeparator({ className, ...rest }: ComponentProps<typeof Radix.Separator>) {
  return <Radix.Separator className={cn('my-1 h-px bg-border', className)} {...rest} />;
}
