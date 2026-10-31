'use client';

import { Popover as RadixPopover, Tooltip as RadixTooltip } from 'radix-ui';
import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';

const COARSE = '(pointer: coarse)';
function subscribe(cb: () => void) {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE).matches,
    () => false,
  );
}

export interface TooltipProps {
  /** Текст підказки. */
  content: ReactNode;
  /** Тригер: один елемент, що приймає ref (кнопка, посилання, span із tabIndex=0). */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** false — не перекидати на інший бік (напр. щоб не лягти на відео). */
  avoidCollisions?: boolean;
  /** Область, поза яку підказка не виходить (під плеєром). */
  collisionBoundary?: Element | null | Array<Element | null>;
  /** Керований стан (для історій). */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const CONTENT =
  'z-30 max-w-64 rounded-md border border-border bg-surface-raised px-3 py-2 text-caption text-text shadow-overlay';

/**
 * P14. Підказка (WCAG 1.4.13): не зникає сама, на неї можна навести курсор, Esc закриває.
 * На дотик (грубий вказівник) замість підказки відкривається Popover.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align,
  avoidCollisions,
  collisionBoundary,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: TooltipProps) {
  const coarse = useCoarsePointer();
  const boundary = collisionBoundary as Element | Element[] | undefined;
  if (coarse) {
    return (
      <RadixPopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
        <RadixPopover.Trigger asChild>{children}</RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            side={side}
            align={align}
            avoidCollisions={avoidCollisions}
            sideOffset={8}
            collisionPadding={8}
            collisionBoundary={boundary}
            className={cn(CONTENT, className)}
          >
            {content}
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    );
  }
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={300} disableHoverableContent={false}>
      <RadixTooltip.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            avoidCollisions={avoidCollisions}
            sideOffset={8}
            collisionPadding={8}
            collisionBoundary={boundary}
            className={cn(CONTENT, className)}
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
