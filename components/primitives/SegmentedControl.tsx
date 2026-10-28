'use client';

import { ToggleGroup } from 'radix-ui';
import { cn } from './cn';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import { Flag } from './Flag';
import { Icon } from './Icon';

export interface SegmentOption {
  value: string;
  label: string;
  /** Маленька жовта позначка біля назви («Перший ряд» — лише учасникам). */
  dot?: boolean;
  disabled?: boolean;
  /** Круглий прапор перед підписом (чип «Країна»). */
  flag?: string;
  /** Доступна назва, якщо підпис скорочено («Країна: Україна»). */
  ariaLabel?: string;
  /** Чип відкриває список (кілька країн у кімнаті перегляду): вибір пункту обирає цю кімнату. */
  menu?: { items: { value: string; label: string; flag: string }[]; selected: string; onSelect: (value: string) => void };
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

/* Макет (`Main`, «Пояси / Звідки дивляться»): доріжка 34 px surface-raised, пігулка 30 px, вибрана — border-колір;
   ціль дотику — 44 px (кнопка виходить за доріжку на 5 px згори й знизу). Розміри — у primitives.css (`t2f-seg*`). */
const ITEM = 't2f-focus t2f-seg-item';
const SELECTED = '';

/** P11. Сегментований перемикач. */
export function SegmentedControl({ label, options, value, onValueChange, semantics = 'radio', className }: SegmentedControlProps) {
  const body = (o: SegmentOption) => (
    <span className="t2f-seg-pill">
      {o.flag ? <Flag round code={o.flag} size="xs" decorative /> : null}
      {o.label}
      {o.menu ? <Icon name="chevron-down" size={12} strokeWidth={2.2} className="-me-0.5" /> : null}
      {o.dot && <span className="size-2 rounded-full bg-highlight" aria-hidden="true" />}
    </span>
  );
  if (semantics === 'pressed') {
    return (
      <div role="group" aria-label={label} className={cn('t2f-seg', className)}>
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
      className={cn('t2f-seg', className)}
    >
      {options.map((o) =>
        o.menu ? (
          <DropdownMenu key={o.value}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-pressed={o.value === value}
                aria-label={o.ariaLabel}
                aria-haspopup="menu"
                disabled={o.disabled}
                data-state={o.value === value ? 'on' : 'off'}
                className={cn(ITEM, SELECTED)}
              >
                {body(o)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {o.menu.items.map((it) => (
                <DropdownMenuItem key={it.value} onSelect={() => o.menu!.onSelect(it.value)} aria-current={it.value === o.menu!.selected ? 'true' : undefined}>
                  <Flag round code={it.flag} size="xs" decorative />
                  {it.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <ToggleGroup.Item key={o.value} value={o.value} disabled={o.disabled} aria-label={o.ariaLabel} className={cn(ITEM, SELECTED)}>
            {body(o)}
          </ToggleGroup.Item>
        ),
      )}
    </ToggleGroup.Root>
  );
}
