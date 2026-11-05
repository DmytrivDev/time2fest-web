'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import type { HowTo } from '@/lib/data/types';

export type Tradition = HowTo['traditions'][number];

export type HowToVariant = 'full' | 'compact' | 'tv';

export interface HowToCardProps {
  /** Назва країни для заголовка «Як святкувати · Франція» (без відмінювання). */
  country: string;
  traditions: readonly Tradition[];
  /**
   * `full` — сторінка країни: три картки (на телефоні гортаються вбік) ·
   * `compact` — біля плеєра (−15…+10 хв): жовта смуга ліворуч, 2–4 пункти ·
   * `tv` — бічна колонка S-TV.
   */
  variant?: HowToVariant;
  /** Рівень заголовка (за замовчуванням `h2`). */
  headingLevel?: 'h2' | 'h3';
  /** `full`: до трьох фото (≈60/40) з автором і ліцензією; порожньо — блоку немає. */
  gallery?: HowTo['gallery'];
  /** `full`: текстовий блок країни під заголовком «Як <Країна> зустрічає Новий рік» (без «Читати більше»). */
  text?: string;
  className?: string;
}

/** Іконка традиції за `iconId` з даних (рішення 2026-11-05: іконки за змістом, а не однакова зірка). */
const TRADITION_ICONS: Readonly<Record<string, IconName>> = {
  countdown: 'clock',
  clock: 'clock',
  feast: 'utensils',
  food: 'utensils',
  noodles: 'utensils',
  fireworks: 'sparkles',
  lights: 'sparkles',
  mistletoe: 'mistletoe',
  kiss: 'heart',
  bell: 'bell',
  song: 'party',
  ball: 'party',
  shrine: 'home',
  door: 'home',
  camp: 'users',
  white: 'star',
  flower: 'heart',
  beach: 'globe',
  wave: 'globe',
  boat: 'globe',
};

function TraditionIcon({ size, iconId }: { size: 'md' | 'lg'; iconId?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-highlight-tint text-highlight ring-1 ring-inset ring-highlight/30',
        size === 'lg' ? 'size-16' : 'size-12',
      )}
    >
      <Icon name={(iconId && TRADITION_ICONS[iconId]) || 'star'} size={22} />
    </span>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** C20. «Як святкувати»: ключові традиції країни. */
export function HowToCard({
  country,
  traditions,
  variant = 'full',
  headingLevel: Heading = 'h2',
  gallery,
  text,
  className,
}: HowToCardProps) {
  const t = useTranslations('liveCards.howTo');
  const tc = useTranslations('country.howTo');
  const headingId = useId();

  if (variant === 'compact') {
    const items = traditions.slice(0, 4);
    return (
      <section
        aria-labelledby={headingId}
        data-how-to="compact"
        className={cn(
          'flex flex-col gap-2 rounded-md border-s-2 border-highlight bg-surface px-4 py-3',
          className,
        )}
      >
        <Heading id={headingId} className="text-label-sm text-highlight">
          {t('compactTitle')}
        </Heading>
        <ul aria-label={t('list')} className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((item) => (
            <li key={item.id} className="text-body-lg text-text-secondary">
              <strong className="font-semibold text-text">{item.title}.</strong> {item.text}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (variant === 'tv') {
    return (
      <section
        aria-labelledby={headingId}
        data-how-to="tv"
        className={cn('flex flex-col gap-3', className)}
      >
        <Heading id={headingId} className="text-tv-title text-text">
          {t('title', { country })}
        </Heading>
        <ol aria-label={t('list')} className="m-0 flex list-none flex-col gap-3 p-0">
          {traditions.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-4 rounded-lg border border-border bg-surface px-4 py-3"
            >
              <TraditionIcon size="md" iconId={item.iconId} />
              <div className="min-w-0">
                <h3 className="text-tv-title text-text">{item.title}</h3>
                <p className="mt-2 text-tv-text text-text-secondary">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const photos = (gallery ?? []).slice(0, 3);
  return (
    <section
      aria-labelledby={headingId}
      data-how-to="full"
      className={cn('flex flex-col gap-5', className)}
    >
      <Heading id={headingId} className="text-headline-md text-text">
        {t('title', { country })}
      </Heading>
      {/* Телефон: ряд гортається вбік (область з фокусом), від 768 px — три колонки. */}
      {/* Прокручувана область має бути досяжною з клавіатури (WCAG 2.1.1). */}
      <ol
        aria-label={t('list')}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- прокручувана область
        tabIndex={0}
        className="t2f-focus t2f-no-scrollbar m-0 flex list-none snap-x gap-4 overflow-x-auto p-0 md:grid md:grid-cols-3 md:overflow-visible"
      >
        {traditions.map((item, i) => (
          <li
            key={item.id}
            className="flex w-72 shrink-0 snap-start flex-col gap-3.5 rounded-lg border border-border bg-surface p-6 md:w-auto"
          >
            <div className="flex items-center justify-between">
              <TraditionIcon size="lg" iconId={item.iconId} />
              <span aria-hidden="true" className="text-label-badge tabular-nums text-text-muted">
                {pad(i + 1)}
              </span>
            </div>
            <div>
              <h3 className="text-headline-sm text-text">{item.title}</h3>
              <p className="mt-1.5 text-body text-text-secondary">{item.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {photos.length || text ? (
        // «Як <Країна> зустрічає Новий рік»: ліворуч заголовок і текст, праворуч галерея; верх заголовка — на рівні верху
        // галереї (правка власника 2026-11-05).
        <div
          data-country-story=""
          className={cn(
            'mt-6 flex flex-col gap-4',
            photos.length > 0 && 'md:grid md:grid-cols-2 md:items-start md:gap-7',
          )}
        >
          {text ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-headline-md text-text">{tc('textTitle', { country })}</h3>
              <p className="text-body text-text-secondary">{text}</p>
            </div>
          ) : null}
          {photos.length ? (
            <ul
              aria-label={tc('gallery')}
              className={cn(
                'm-0 grid list-none gap-3 p-0 md:h-80 md:grid-rows-2',
                photos.length > 1 && 'md:grid-flow-col md:grid-cols-5',
              )}
            >
              {photos.map((ph, i) => (
                <li
                  key={ph.src}
                  className={cn(
                    'relative min-h-0 overflow-hidden rounded-lg border border-border bg-surface',
                    photos.length === 1 && 'md:row-span-2',
                    photos.length > 1 &&
                      (i === 0
                        ? 'md:col-span-3 md:row-span-2'
                        : cn('md:col-span-2', photos.length === 2 && 'md:row-span-2')),
                  )}
                >
                  <figure className="m-0 size-full">
                    {/* Статичний експорт: next/image без оптимізації не дає переваг — звичайний img. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ph.src}
                      alt={tc('photoAlt', { alt: ph.alt })}
                      loading="lazy"
                      className="aspect-video size-full object-cover md:aspect-auto"
                    />
                    <figcaption className="absolute inset-x-0 bottom-0 bg-bg/80 px-3 py-1.5 text-caption text-text-secondary">
                      {tc('photoCredit', { author: ph.author, license: ph.license })}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
