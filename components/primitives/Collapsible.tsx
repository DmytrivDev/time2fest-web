'use client';

import { Collapsible as Radix } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface CollapsibleProps {
  /** Підпис тригера («Ще 14 країн поясу», «Трансляції в цьому поясі»). */
  title: ReactNode;
  /** Короткі метадані праворуч (кількість). */
  meta?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

/** P28. Розгортаний блок. Тригер — кнопка ≥ 44 px з `aria-expanded`. */
export function Collapsible({ title, meta, open, defaultOpen, onOpenChange, disabled, children, className }: CollapsibleProps) {
  return (
    <Radix.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      className={cn('rounded-lg border border-border bg-surface', className)}
    >
      <Radix.Trigger className="t2f-focus t2f-transition group flex min-h-touch-min w-full items-center gap-3 rounded-lg px-4 text-start text-body-strong text-text hover:bg-surface-raised disabled:text-text-muted">
        <span className="flex-1">{title}</span>
        {meta !== undefined && <span className="text-caption text-text-muted">{meta}</span>}
        <Icon name="chevron-down" size={18} className="group-aria-expanded:rotate-180" />
      </Radix.Trigger>
      <Radix.Content className="t2f-acc-content">
        <div className="px-4 pb-4 pt-1 text-body text-text-secondary">{children}</div>
      </Radix.Content>
    </Radix.Root>
  );
}
