'use client';

/**
 * «Як тобі шоу?» рядком усередині штампа (рішення власника 2026-11-01, дошка `Desk-Rate-Placement`, варіант A):
 * штамп і оцінка — про те саме шоу, тож одна картка. З’являється разом зі штампом під його кнопками; «×» прибирає
 * штамп разом з оцінкою — оцінити можна й пізніше в паспорті. Без підписів «слабко / неймовірно» — зірки зрозумілі
 * й так. Після оцінки — «Твоя оцінка ★★★★☆ · Дякуємо!» (зірки не зсуваються); зірки лишаються активними, тож оцінку
 * можна змінити. Кілька подій (Сідней · Мельбурн) — рядок на кожне місто.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Link } from '@/components/primitives/Link';
import { RadioGroup, type RadioOption } from '@/components/primitives/RadioGroup';
import type { Stars } from '@/lib/data/types';
import s from './stampRate.module.css';

export interface StampRateRow {
  eventId: string;
  city: string;
}

export interface StampRateProps {
  rows: StampRateRow[];
  values: Partial<Record<string, Stars>>;
  onRate: (eventId: string, stars: Stars) => void;
  /** `card` — у штампі під плеєром; `compact` — у клітинці паспорта. */
  layout?: 'card' | 'compact';
  ratingHref?: string;
  className?: string;
}

const STARS_VALUES = [1, 2, 3, 4, 5] as const;

export function StampRate({ rows, values, onRate, layout = 'card', ratingHref = '/rating', className }: StampRateProps) {
  const t = useTranslations('windows.rate');
  const options: RadioOption[] = STARS_VALUES.map((n) => ({ value: String(n), label: t('star', { n }) }));
  const multi = rows.length > 1;
  return (
    <div className={cn(s.wrap, layout === 'compact' && s.compact, className)} data-stamp-rate="">
      {rows.map((row) => {
        const value = values[row.eventId];
        const rated = value !== undefined;
        return (
          <div key={row.eventId} className={s.row} data-rated={rated || undefined}>
            {/* Обидва підписи в одній клітинці (невидимий тримає ширину) — зірки не зсуваються після оцінки. */}
            <span className={s.label}>
              <span className={s.labelText} aria-hidden={rated || undefined}>
                {t('title')}
                {multi ? <span className={s.city}> · {row.city}</span> : null}
              </span>
              <span className={s.labelText} aria-hidden={!rated || undefined}>
                {t('yours')}
                {multi ? <span className={s.city}> · {row.city}</span> : null}
              </span>
            </span>
            <RadioGroup
              variant="stars"
              label={`${t('title')} ${row.city}`}
              options={options}
              value={value === undefined ? '' : String(value)}
              onValueChange={(v) => onRate(row.eventId, Number(v) as Stars)}
              className={s.stars}
            />
            {!rated ? null : (
              <span className={s.hint} role="status">
                {t('thanks')}!{' '}
                {layout === 'card' ? (
                  <Link href={ratingHref} className="font-semibold">
                    {t('ratingLink')}
                  </Link>
                ) : null}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
