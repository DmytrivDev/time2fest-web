import type { ReactNode } from 'react';
import { cn } from './cn';

export interface SectionHeaderProps {
  /** Заголовок блоку (`h2` за замовчуванням: кожен блок має h2). */
  title: ReactNode;
  as?: 'h2' | 'h3';
  /** Мета: «за вашим часом (Київ)». */
  meta?: ReactNode;
  /** Слот дії праворуч: Switch, «Згорнути», лічильник. */
  action?: ReactNode;
  id?: string;
  className?: string;
}

/** P34. Заголовок секції: h2 + мета + дія. */
export function SectionHeader({ title, as: Heading = 'h2', meta, action, id, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex min-h-touch-min items-center justify-between gap-3', className)}>
      {/* Макети: телефон — мета під заголовком; ширше — в рядок за базовою лінією, відступ 12 px. */}
      <div className="flex min-w-0 flex-col md:flex-row md:items-baseline md:gap-3">
        <Heading id={id} className="t2f-h2 text-text">
          {title}
        </Heading>
        {meta ? <p className="whitespace-nowrap text-caption text-text-muted">{meta}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}
