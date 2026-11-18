'use client';

/** «Коротко про головне»: акордеон у дві колонки, перше питання відкрите. */
import { useId, useState } from 'react';
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

export function PrefestFaq() {
  const t = useTranslations('prefest');
  const q = useTranslations('prefest.faq');
  const { model, site } = usePrefest();
  const ready = useClientReady();
  const reduced = useReducedMotion();
  const base = useId();
  const [open, setOpen] = useState<string>('1');

  const MARK = '';
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
    <section className={cn(s.sec, s.wrap)} aria-labelledby="faq-h">
      <h2 className={s.h2} id="faq-h">
        {q('title')}
      </h2>
      <div className={cn(f.faq, reduced && f.still)}>
        {(site ? SITE_KEYS : KEYS).map((k) => {
          const isOpen = open === k;
          const panel = `${base}-a${k}`;
          return (
            <div className={f.qa} data-open={isOpen} key={k}>
              <h3>
                <button
                  type="button"
                  className={f.btn}
                  aria-expanded={isOpen}
                  aria-controls={panel}
                  onClick={() => setOpen(isOpen ? '' : k)}
                >
                  {q(`q${k}`)}
                  <Icon name="plus" size={20} />
                </button>
              </h3>
              <div className={f.a} id={panel} role="region" aria-hidden={!isOpen} inert={!isOpen}>
                <div>
                  <p>{WITH_WHEN.has(k) ? answerWithWhen(k) : q(`a${k}`)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
