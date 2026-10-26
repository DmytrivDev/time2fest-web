'use client';

/**
 * C20 · CountryHeader — шапка сторінки країни (S-COUNTRY).
 * Телефон: компактний рядок «Країни › [прапор] Франція» з кнопкою-календарем + рядок про штамп.
 * Десктоп (від 1200 px): прапор `lg`, назва, «північ о 01:00 за вашим часом», рядок про штамп, «Додати в графік».
 * Після півночі: «північ була о …» і «Франція зустріла Новий рік» (`metPhrase`, рід країни).
 * `h1` — на сторінці (sr-only), тут назва — звичайний абзац. Обидва варіанти в DOM, прихований — `display:none`.
 * «Додати в графік» поки неактивна (графік — окрема функція). Назви — лише в називному відмінку.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { Chip, ChipGroup } from '@/components/primitives/Chip';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Link } from '@/components/primitives/Link';
import type { Country } from '@/lib/data/types';
import { joinNamesUk, metPhrase } from '@/lib/engine/metPhrase';
import { formatClock } from '@/lib/i18n/time';
import styles from './live.module.css';

export interface CountryHeaderProps {
  country: Pick<Country, 'iso' | 'name' | 'flagCode' | 'gender'>;
  /** Північ головної події вибраного поясу. */
  midnightMs: number;
  /** Після півночі (+15 с): «північ була о …» і фраза «зустріла Новий рік». */
  after: boolean;
  /** Країни з кількома поясами: чипи поясів («UTC+3 · Москва»); менше двох — без чипів. */
  zones?: readonly { id: string; label: string }[];
  selectedZoneId?: string;
  onZoneChange?(zoneId: string): void;
  /** Часовий пояс глядача (тести, історії); типово — пояс браузера. */
  timeZone?: string;
  className?: string;
}

export function CountryHeader({
  country,
  midnightMs,
  after,
  zones,
  selectedZoneId,
  onZoneChange,
  timeZone,
  className,
}: CountryHeaderProps) {
  const t = useTranslations('country.header');
  const tNav = useTranslations('header');
  const tMet = useTranslations('met');

  const name = country.name.uk;
  const time = formatClock(midnightMs, timeZone ? { timeZone } : {});
  const bold = (chunks: ReactNode) => <b className="font-semibold text-text">{chunks}</b>;
  const timeLine = after ? t.rich('midnightWas', { time, b: bold }) : t.rich('midnightAt', { time, b: bold });

  let noteLine: string;
  if (after) {
    const p = metPhrase(country);
    noteLine = p.kind === 'single' ? tMet('single', p.params) : p.kind === 'multi' ? tMet('multi', { names: joinNamesUk(p.params.names) }) : tMet('fallback', p.params);
  } else {
    noteLine = t('stamp');
  }

  const note = (
    <p className="flex items-center gap-1.5 text-caption text-text-secondary">
      <Icon name="passport" size={16} className="shrink-0" />
      {noteLine}
    </p>
  );

  return (
    <div data-country-header="" data-after={after ? '' : undefined} className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        <nav aria-label={t('breadcrumbs')} className="min-w-0 flex-1 text-caption text-text-muted">
          <ol className="m-0 flex list-none items-center gap-1.5 p-0">
            <li>
              <Link href="/countries/" variant="inline" className="inline-flex min-h-touch-min items-center text-text-secondary no-underline hover:text-text">
                {tNav('countries')}
              </Link>
            </li>
            <li aria-hidden="true" className="flex items-center">
              <Icon name="chevron-right" size={16} />
            </li>
            <li className="flex items-center gap-2">
              <span className={styles.phoneOnly}>
                <Flag code={country.flagCode} size="sm" decorative />
              </span>
              <span aria-current="page" className="font-semibold text-text">
                {name}
              </span>
            </li>
          </ol>
        </nav>
        <IconButton
          icon="calendar-add"
          variant="ring"
          disabled
          aria-label={t('addToSchedule')}
          className={cn(styles.phoneOnly, 'shrink-0')}
        />
      </div>

      <div className={styles.phoneOnly}>{note}</div>

      <div className={cn(styles.deskOnly, 'flex-wrap items-center gap-x-6 gap-y-3 pb-2 pt-2')}>
        <Flag code={country.flagCode} size="lg" decorative />
        <div className="min-w-0 flex-1">
          <p className="text-headline-lg text-text">{name}</p>
          <p className="text-body text-text-muted">{timeLine}</p>
          <div className="mt-1">{note}</div>
        </div>
        <Button variant="secondary" iconLeft="calendar-add" disabled>
          {t('addToSchedule')}
        </Button>
      </div>

      {zones && zones.length >= 2 ? (
        <ChipGroup label={t('zones')} scroll>
          {zones.map((z) => (
            <Chip key={z.id} variant="filter" selected={z.id === selectedZoneId} onSelectedChange={() => onZoneChange?.(z.id)}>
              {z.label}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}
    </div>
  );
}
