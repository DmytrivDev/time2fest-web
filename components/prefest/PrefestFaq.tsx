'use client';

/** «Коротко про головне»: акордеон у дві колонки, перше питання відкрите. */
import { Fragment, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Bar } from '@/components/skeleton/parts';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { clock, dayMonth } from '@/lib/prefest/format';
import { useClientReady, usePrefest } from './PrefestContext';
import f from './PrefestFaq.module.css';
import s from './prefest.module.css';

const KEYS = ['1', '2', '3', '4'] as const;
/** Мовне дерево (рішення власника 2026-11-18): ще «хто першим» і «хто останнім». */
const SITE_KEYS = ['1', '2', '3', '4', '5', '6'] as const;
/** Відповіді з часом першої півночі за часом відвідувача. */
const WITH_WHEN = new Set(['2', '5']);

export interface PrefestFaqItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
}

/**
 * Вигляд «Коротко про головне» для будь-якого переліку питань: заголовок і акордеон у дві колонки, перше питання
 * відкрите. Передстартовий сайт ставить його й на сторінках паса, тостів і країни (рішення власника 2026-11-19).
 */
export function PrefestFaqList({
  title,
  items,
  className,
  headingId,
  stacks = false,
}: {
  title: ReactNode;
  items: readonly PrefestFaqItem[];
  className?: string;
  /** Сталий id заголовка (головна — `faq-h`); без нього — згенерований. */
  headingId?: string;
  /**
   * Дві незалежні колонки (передстартовий сайт, рішення власника 2026-11-19): відкрите питання ліворуч не зсуває
   * картки праворуч. Перша половина — ліворуч, друга — праворуч; на телефоні — одна колонка в тому самому порядку.
   */
  stacks?: boolean;
}) {
  const reduced = useReducedMotion();
  const base = useId();
  const hid = headingId ?? `${base}-h`;
  const [open, setOpen] = useState<string>(items[0]?.id ?? '');
  return (
    <section className={className} aria-labelledby={hid}>
      <h2 className={s.h2} id={hid}>
        {title}
      </h2>
      <div className={cn(f.faq, reduced && f.still)}>
        {(stacks ? halves(items) : [items]).map((column, ci) => {
          const list = column.map(({ id, question, answer }) => {
            const isOpen = open === id;
            const panel = `${base}-a${id}`;
            return (
              <div className={f.qa} data-open={isOpen} key={id}>
                <h3>
                  <button
                    type="button"
                    className={f.btn}
                    aria-expanded={isOpen}
                    aria-controls={panel}
                    onClick={() => setOpen(isOpen ? '' : id)}
                  >
                    {question}
                    <Icon name="plus" size={20} />
                  </button>
                </h3>
                <div className={f.a} id={panel} role="region" aria-hidden={!isOpen} inert={!isOpen}>
                  <div>
                    <p>{answer}</p>
                  </div>
                </div>
              </div>
            );
          });
          return stacks ? (
            <div className={f.stack} key={ci}>
              {list}
            </div>
          ) : (
            <Fragment key={ci}>{list}</Fragment>
          );
        })}
      </div>
    </section>
  );
}

/** Перша половина питань — ліворуч, друга — праворуч. */
function halves<T>(items: readonly T[]): (readonly T[])[] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

export function PrefestFaq() {
  const t = useTranslations('prefest');
  const q = useTranslations('prefest.faq');
  const { model, site } = usePrefest();
  const ready = useClientReady();

  const MARK = '';
  const when = ready
    ? t('dateAt', { date: dayMonth(model.firstMidnightMs), time: clock(model.firstMidnightMs) })
    : MARK;
  const answerWithWhen = (k: string) => {
    const parts = q(`a${k}`, { when }).split(MARK);
    return parts.length === 1 ? (
      parts[0]
    ) : (
      <>
        {parts[0]}
        <Bar className={f.skel} h={14} w={140} />
        {parts[1]}
      </>
    );
  };

  return (
    <PrefestFaqList
      className={cn(s.sec, s.wrap)}
      stacks={site !== null}
      headingId="faq-h"
      title={q('title')}
      items={(site ? SITE_KEYS : KEYS).map((k) => ({
        id: k,
        question: q(`q${k}`),
        answer: WITH_WHEN.has(k) ? answerWithWhen(k) : q(`a${k}`),
      }))}
    />
  );
}
