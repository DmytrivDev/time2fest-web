'use client';

/**
 * «Питання й відповіді» (C19, C20): секція з `h2` і Accordion (один відкритий пункт).
 * Сторінка країни — одна колонка; список країн на десктопі — дві колонки на всю ширину.
 * Тексти питань — без відмінювання назв (шаблони «<Країна> · …»).
 */
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Accordion } from '@/components/primitives/Accordion';
import { cn } from '@/components/primitives/cn';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface FaqProps {
  items: readonly FaqItem[];
  /** `2` — дві колонки від десктопа (список країн). */
  columns?: 1 | 2;
  className?: string;
}

export function Faq({ items, columns = 1, className }: FaqProps) {
  const tNav = useTranslations('nav');
  const headingId = useId();
  if (!items.length) return null;
  const toData = (list: readonly FaqItem[]) => list.map((it) => ({ value: it.id, title: it.question, content: it.answer }));
  const half = Math.ceil(items.length / 2);
  return (
    <section aria-labelledby={headingId} data-faq="" className={cn('flex flex-col gap-3', className)}>
      <h2 id={headingId} className="text-headline-sm text-text">
        {tNav('faq')}
      </h2>
      {columns === 2 ? (
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
          <Accordion items={toData(items.slice(0, half))} />
          {items.length > half ? <Accordion items={toData(items.slice(half))} /> : null}
        </div>
      ) : (
        <Accordion items={toData(items)} />
      )}
    </section>
  );
}
