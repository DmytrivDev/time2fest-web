'use client';

import { Tabs as Radix } from 'radix-ui';
import { createContext, useContext, type ComponentProps } from 'react';
import { cn } from './cn';
import { Badge } from './Badge';

export type TabsVariant = 'underline' | 'tv';
const VariantContext = createContext<TabsVariant>('underline');

export interface TabsProps extends ComponentProps<typeof Radix.Root> {
  /** `underline` — «Події | Чат» (14/600, смужка 2 px) · `tv` — бічна колонка ТВ (вибране: surface-raised + смужка, I-13). */
  variant?: TabsVariant;
}

/** P10. Вкладки за шаблоном ARIA tabs (Radix Tabs). */
export function Tabs({ variant = 'underline', className, ...rest }: TabsProps) {
  return (
    <VariantContext.Provider value={variant}>
      <Radix.Root data-variant={variant} className={className} {...rest} />
    </VariantContext.Provider>
  );
}

export function TabsList({ className, ...rest }: ComponentProps<typeof Radix.List>) {
  const variant = useContext(VariantContext);
  return (
    <Radix.List
      className={cn('flex', variant === 'underline' ? 'border-b border-border' : 'flex-col gap-1', className)}
      {...rest}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof Radix.Trigger> {
  /** Лічильник нових (не live-область); понад 99 показується «99+». */
  count?: number;
}

export function TabsTrigger({ className, count, children, ...rest }: TabsTriggerProps) {
  const variant = useContext(VariantContext);
  return (
    <Radix.Trigger
      className={cn(
        't2f-focus t2f-transition inline-flex min-h-touch-min items-center justify-center gap-2 whitespace-nowrap text-text-muted hover:text-text aria-selected:text-text',
        variant === 'underline' &&
          '-mb-px flex-1 border-b-2 border-transparent px-4 text-label-sm aria-selected:border-text',
        variant === 'tv' &&
          'min-h-14 justify-start rounded-md border-s-4 border-transparent px-4 text-tv-text hover:bg-surface aria-selected:border-text aria-selected:bg-surface-raised',
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined && count > 0 ? <Badge variant="count" value={count} /> : null}
    </Radix.Trigger>
  );
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof Radix.Content>) {
  return <Radix.Content className={cn('t2f-focus', className)} {...rest} />;
}
