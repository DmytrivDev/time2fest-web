'use client';

import { ScrollArea as Radix } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export interface ScrollAreaProps extends ComponentProps<typeof Radix.Root> {
  /** Напрямок прокрутки; смуга тонка, `border-strong`, заокруглена (не системна). */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Клас вікна перегляду. */
  viewportClassName?: string;
  /** Доступна назва прокручуваної області (тоді вікно перегляду стає фокусованою областю). */
  label?: string;
}

/** P27. Прокрутка у вікнах і чаті — не системна (ІНВ 5.6). */
export function ScrollArea({
  orientation = 'vertical',
  className,
  viewportClassName,
  label,
  children,
  ...rest
}: ScrollAreaProps) {
  return (
    <Radix.Root className={cn('relative overflow-hidden', className)} {...rest}>
      <Radix.Viewport
        className={cn('t2f-focus size-full', viewportClassName)}
        aria-label={label}
        role={label ? 'region' : undefined}
        tabIndex={label ? 0 : undefined}
      >
        {children}
      </Radix.Viewport>
      {orientation !== 'horizontal' && <Bar orientation="vertical" />}
      {orientation !== 'vertical' && <Bar orientation="horizontal" />}
      <Radix.Corner />
    </Radix.Root>
  );
}

function Bar({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  return (
    <Radix.Scrollbar
      orientation={orientation}
      className={cn(
        'flex touch-none select-none p-0.5',
        orientation === 'vertical' ? 'h-full w-2.5 flex-col' : 'h-2.5 w-full flex-row',
      )}
    >
      <Radix.Thumb className="relative flex-1 rounded-full bg-border-strong" />
    </Radix.Scrollbar>
  );
}
