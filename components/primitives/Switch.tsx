'use client';

import { Switch as Radix } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export interface SwitchProps extends Omit<ComponentProps<typeof Radix.Root>, 'children'> {
  /** Видимий підпис (обов'язковий: фільтри «так / ні» — `role="switch"` з видимим підписом). */
  label: ReactNode;
  /** Підпис ліворуч від доріжки (за замовчуванням) чи праворуч. */
  labelSide?: 'start' | 'end';
  /** Компактний: шапка чату, футер (13 px). */
  compact?: boolean;
}

/** P7. Перемикач. Весь рядок — ціль 44 px; доріжка 36×20, повзунок 14. Вимкнений (напр. «Необхідні» в cookies) — сірий і в увімкненому стані. */
export function Switch({ label, labelSide = 'start', compact = false, className, ...rest }: SwitchProps) {
  // Макети: 14/500 text-secondary (фільтри), 13/500 text (футер).
  const text = <span className={cn('text-start font-medium', compact ? 'text-caption text-text' : 'text-label-sm text-text-secondary')}>{label}</span>;
  return (
    <Radix.Root
      className={cn(
        't2f-focus t2f-transition group inline-flex min-h-touch-min items-center rounded-md bg-transparent text-text disabled:cursor-not-allowed disabled:text-text-muted',
        compact ? 'gap-2.5' : 'gap-2',
        className,
      )}
      {...rest}
    >
      {labelSide === 'start' && text}
      <span
        aria-hidden="true"
        className="t2f-transition relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-strong bg-surface-raised group-aria-checked:border-text group-aria-checked:bg-text group-disabled:border-border group-aria-checked:group-disabled:border-border-strong group-aria-checked:group-disabled:bg-border"
      >
        <Radix.Thumb className="t2f-transition block size-3.5 translate-x-0.5 rounded-full bg-text-muted group-aria-checked:translate-x-4.5 group-aria-checked:bg-background group-disabled:bg-border-strong group-aria-checked:group-disabled:bg-text-muted" />
      </span>
      {labelSide === 'end' && text}
    </Radix.Root>
  );
}
