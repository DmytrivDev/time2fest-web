'use client';

import { Checkbox as Radix } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface CheckboxProps extends Omit<ComponentProps<typeof Radix.Root>, 'children'> {
  label: ReactNode;
  /** Лічильник праворуч («19» у «Наживо · 19»). */
  count?: number | string;
}

/** P8. Прапорець — лише для вибору кількох пунктів у списку (фільтри «так / ні» — Switch). */
export function Checkbox({ label, count, className, ...rest }: CheckboxProps) {
  return (
    <Radix.Root
      className={cn(
        't2f-focus t2f-transition group flex min-h-touch-min w-full items-center gap-3 rounded-md px-1 text-start text-body text-text hover:bg-surface-raised disabled:text-text-muted disabled:hover:bg-transparent',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="t2f-transition inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-background text-background group-aria-checked:border-text group-aria-checked:bg-text group-disabled:border-border"
      >
        <Radix.Indicator>
          <Icon name="check" size={16} strokeWidth={2.6} />
        </Radix.Indicator>
      </span>
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-caption text-text-muted">{count}</span>}
    </Radix.Root>
  );
}
