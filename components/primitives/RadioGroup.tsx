'use client';

import { RadioGroup as Radix } from 'radix-ui';
import { Emoji } from './Emoji';
import { Fragment, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export type RadioVariant = 'list' | 'grid' | 'stars';

export interface RadioOption {
  value: string;
  /** Назва варіанта (для `grid` — назва емодзі з набору O-EMOJI, не символ). */
  label: string;
  /** `list`: мова пункту (`lang`), назва мовою пункту без прапора. */
  lang?: string;
  /** `grid`: символ емодзі (візуально; у назву не потрапляє). */
  symbol?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  variant?: RadioVariant;
  /** Назва групи (для зчитувача). */
  label: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Контент після кожного пункту `list` (напр. позначка). */
  renderExtra?: (option: RadioOption) => ReactNode;
}

const ROW =
  't2f-focus t2f-transition flex min-h-touch-min w-full items-center gap-3 rounded-md px-3 text-start text-body text-text hover:bg-surface-raised disabled:text-text-muted';

/** P9. Група радіокнопок: `list` (мови), `grid` (емодзі 44×44), `stars` (5 × 44 px). */
export function RadioGroup({
  variant = 'list',
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  className,
  renderExtra,
}: RadioGroupProps) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const change = (v: string) => {
    setInner(v);
    onValueChange?.(v);
  };
  const selectedIndex = options.findIndex((o) => o.value === current);
  // `stars`: під курсором миші світяться зірки до наведеної включно — видно, яку оцінку поставиш (власник 2026-11-07).
  const [hoverIndex, setHoverIndex] = useState(-1);
  const litIndex = variant === 'stars' && hoverIndex >= 0 ? hoverIndex : selectedIndex;

  return (
    <Radix.Root
      aria-label={label}
      value={current}
      onValueChange={change}
      disabled={disabled}
      orientation={variant === 'list' ? 'vertical' : 'horizontal'}
      onPointerLeave={variant === 'stars' ? () => setHoverIndex(-1) : undefined}
      data-hover={variant === 'stars' && hoverIndex >= 0 ? hoverIndex + 1 : undefined}
      className={cn(
        variant === 'list' && 'flex flex-col',
        variant === 'grid' && 'grid grid-cols-4 gap-1',
        variant === 'stars' && 'flex gap-2',
        className,
      )}
    >
      {options.map((o, i) => (
        <Fragment key={o.value}>
          {variant === 'list' && (
            <Radix.Item value={o.value} disabled={o.disabled} lang={o.lang} className={cn(ROW, 'group')}>
              <span
                aria-hidden="true"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong group-aria-checked:border-text"
              >
                <Radix.Indicator className="size-2.5 rounded-full bg-text" />
              </span>
              <span className="flex-1">{o.label}</span>
              {renderExtra?.(o)}
            </Radix.Item>
          )}
          {variant === 'grid' && (
            <Radix.Item
              value={o.value}
              disabled={o.disabled}
              aria-label={o.label}
              className="t2f-focus t2f-transition inline-flex size-touch-min items-center justify-center rounded-lg border-2 border-transparent text-headline-sm hover:bg-surface-raised aria-checked:border-text"
            >
              {o.symbol ? <Emoji char={o.symbol} /> : null}
            </Radix.Item>
          )}
          {variant === 'stars' && (
            <Radix.Item
              value={o.value}
              disabled={o.disabled}
              aria-label={o.label}
              data-lit={i <= litIndex || undefined}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') setHoverIndex(i);
              }}
              className={cn(
                't2f-focus t2f-transition inline-flex size-touch-min items-center justify-center rounded-md hover:bg-surface-raised',
                i <= litIndex ? 'text-highlight' : 'text-text-muted',
              )}
            >
              {/* Макет `Desk-Rate`: зірка 32 px, штрих 1.6. */}
              <Icon name="star" size={32} strokeWidth={1.6} fill={i <= litIndex ? 'currentColor' : 'none'} />
            </Radix.Item>
          )}
        </Fragment>
      ))}
    </Radix.Root>
  );
}
