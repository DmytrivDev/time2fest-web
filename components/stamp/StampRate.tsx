'use client';

/**
 * «Як тобі шоу?» рядком усередині штампа (рішення власника 2026-11-01, дошка `Desk-Rate-Placement`, варіант A) і в
 * картці паспорта. Підтвердження оцінки (рішення власника 2026-11-07, дошка `Desk-Rating-New` v2): обрав зірки → на
 * місці зірок «Ти поставив 4 з 5 · Підтвердити · Змінити» → «Твоя оцінка ★★★★☆ · Рейтинг святкувань ›». Оцінка
 * йде в рейтинг лише після «Підтвердити». Висота рядка однакова в усіх станах — під штампом нічого не зсувається.
 * Підписи всіх станів лежать в одній клітинці (невидимі тримають ширину). Кілька подій (Сідней · Мельбурн) — рядок на
 * кожне місто. На самій сторінці рейтингу (`ratingLink={false}`) замість посилання — «Дякуємо!».
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
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
  /** `card` — у штампі під плеєром; `compact` — у картці паспорта й на сторінці рейтингу. */
  layout?: 'card' | 'compact';
  ratingHref?: string;
  /** Після підтвердження — посилання «Рейтинг святкувань ›» (на сторінці рейтингу — `false`: «Дякуємо!»). */
  ratingLink?: boolean;
  className?: string;
}

const STARS_VALUES = [1, 2, 3, 4, 5] as const;

export function StampRate({ rows, values, onRate, layout = 'card', ratingHref = '/rating/', ratingLink = true, className }: StampRateProps) {
  const t = useTranslations('windows.rate');
  const options: RadioOption[] = STARS_VALUES.map((n) => ({ value: String(n), label: t('star', { n }) }));
  const multi = rows.length > 1;
  // Обрано, але ще не підтверджено: eventId → зірки.
  const [pending, setPending] = useState<Partial<Record<string, Stars>>>({});
  return (
    <div className={cn(s.wrap, layout === 'compact' && s.compact, className)} data-stamp-rate="">
      {rows.map((row) => {
        const value = values[row.eventId];
        const chosen = pending[row.eventId];
        const state = chosen !== undefined ? 'chosen' : value !== undefined ? 'rated' : 'ask';
        const label = (key: 'ask' | 'chosen' | 'rated', text: string) => (
          <span className={s.labelText} aria-hidden={state !== key || undefined}>
            {text}
            {multi ? <span className={s.city}> · {row.city}</span> : null}
          </span>
        );
        return (
          <div key={row.eventId} className={s.row} data-rated={state === 'rated' || undefined} data-state={state}>
            <span className={s.label}>
              {label('ask', t('title'))}
              {label('chosen', t('chosen', { n: chosen ?? 0 }))}
              {label('rated', t('yours'))}
            </span>
            {state === 'chosen' ? (
              <span className={s.confirm}>
                <button
                  type="button"
                  data-action="rate-confirm"
                  onClick={() => {
                    onRate(row.eventId, chosen!);
                    setPending((p) => ({ ...p, [row.eventId]: undefined }));
                  }}
                  className={cn('t2f-focus t2f-press', s.confirmBtn)}
                >
                  <Icon name="check" size={16} strokeWidth={2.6} />
                  {t('confirm')}
                </button>
                <button
                  type="button"
                  data-action="rate-change"
                  onClick={() => setPending((p) => ({ ...p, [row.eventId]: undefined }))}
                  className={cn('t2f-focus', s.changeBtn)}
                >
                  {t('change')}
                </button>
              </span>
            ) : (
              <RadioGroup
                variant="stars"
                label={`${t('title')} ${row.city}`}
                options={options}
                value={value === undefined ? '' : String(value)}
                onValueChange={(v) => setPending((p) => ({ ...p, [row.eventId]: Number(v) as Stars }))}
                className={s.stars}
              />
            )}
            {state !== 'rated' ? null : (
              <span className={s.hint} role="status">
                {ratingLink ? (
                  <Link href={ratingHref} className={cn('font-semibold', s.ratingLink)}>
                    {t('ratingLink')}
                    <Icon name="chevron-right" size={14} />
                  </Link>
                ) : (
                  `${t('thanks')}!`
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
