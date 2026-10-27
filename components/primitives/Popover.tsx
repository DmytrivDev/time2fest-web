'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * P15. Спливна панель: меню «+» трансляції, вибір країни чату, готові привітання, «Як святкувати» на мапі.
 * `collisionBoundary` — область під плеєром: панель ніколи не лягає на відео (ІНВ 5.6, NFR-18).
 * Esc закриває й повертає фокус на тригер (Radix).
 */
export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

export type PopoverContentProps = ComponentProps<typeof RadixPopover.Content>;

export function PopoverContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  align = 'start',
  style,
  children,
  ...rest
}: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        style={{ maxHeight: 'var(--radix-popover-content-available-height)', ...style }}
        className={cn(
          'z-30 overflow-y-auto rounded-lg border border-border bg-surface-raised p-3 text-body text-text shadow-overlay',
          className,
        )}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
