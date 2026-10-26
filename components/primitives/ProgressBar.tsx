'use client';

import { Progress } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface ProgressBarProps {
  /** 0..max */
  value: number;
  max?: number;
  /** Назва для зчитувача («Прогрес свята»). */
  label: string;
  /** Читабельний текст значення («Минуло 13 год із 26»); потрапляє в `aria-valuetext`. */
  valueText: string;
  /** Видимий підпис під смужкою; без нього лишається лише `valueText` для зчитувача. */
  caption?: ReactNode;
  className?: string;
}

/** P29. «Прогрес свята»: смужка 3 px з підписом. */
export function ProgressBar({ value, max = 100, label, valueText, caption, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Progress.Root
        value={value}
        max={max}
        aria-label={label}
        aria-valuetext={valueText}
        className="relative h-0.75 w-full overflow-hidden rounded-full bg-border"
      >
        <Progress.Indicator className="h-full w-full rounded-full bg-highlight" style={{ transform: `translateX(-${100 - pct}%)` }} />
      </Progress.Root>
      {caption !== undefined ? <p className="text-caption text-text-muted">{caption}</p> : <p className="sr-only">{valueText}</p>}
    </div>
  );
}
