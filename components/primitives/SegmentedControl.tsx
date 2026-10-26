'use client';

import { ToggleGroup } from 'radix-ui';
import { cn } from './cn';

export interface SegmentOption {
  value: string;
  label: string;
  /** Маленька жовта позначка біля назви («Перший ряд» — лише учасникам). */
  dot?: boolean;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  /** Назва групи для зчитувача. */
  label: string;
  options: SegmentOption[];
  value: string;
  onValueChange: (value: string) => void;
  /**
   * `radio` — перемикає значення (кімнати чату, суми чайових; Radix ToggleGroup) ·
   * `pressed` — кнопки з `aria-pressed` («Пояси / Звідки дивляться»).
   * Якщо перемикає панель, використовуй `Tabs`.
   */
  semantics?: 'radio' | 'pressed';
  className?: string;
}

const ITEM =
  't2f-focus t2f-transition inline-flex min-h-touch-min items-center justify-center gap-2 whitespace-nowrap rounded-full border border-transparent px-4 text-label-sm text-text-secondary hover:text-text disabled:text-text-muted';
// Вибране — surface-raised + межа text, не жовтий (ІНВ I-14).
const SELECTED = 'aria-checked:border-text aria-checked:bg-surface-raised aria-checked:text-text aria-pressed:border-text aria-pressed:bg-surface-raised aria-pressed:text-text';

/** P11. Сегментований перемикач. */
export function SegmentedControl({ label, options, value, onValueChange, semantics = 'radio', className }: SegmentedControlProps) {
  const body = (o: SegmentOption) => (
    <>
      {o.label}
      {o.dot && <span className="size-2 rounded-full bg-highlight" aria-hidden="true" />}
    </>
  );
  if (semantics === 'pressed') {
    return (
      <div role="group" aria-label={label} className={cn('inline-flex rounded-full bg-surface', className)}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(ITEM, SELECTED)}
          >
            {body(o)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        if (v) onValueChange(v);
      }}
      className={cn('inline-flex rounded-full bg-surface', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} disabled={o.disabled} className={cn(ITEM, SELECTED)}>
          {body(o)}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
