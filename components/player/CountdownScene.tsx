'use client';

/**
 * C20. CountdownScene — сцена відліку на місці відео (EXPERIENCE «Плеєр», стани `countdown-scene` і `expected`).
 * Стоїть У СЛОТІ плеєра (`<PlayerSlot fallback={<CountdownScene … />} />`), ніколи поверх відео.
 * Ілюстрація-листівка країни, назва, «Північ о 04:00 за вашим часом», місцевий час, 3 традиції (від ширини ≥ 32rem).
 * Варіант `expected`: «Трансляція почнеться сама, щойно з’явиться». Відлік, статус і дії — у підписі плеєра (PlayerBlock),
 * тут не дублюються (один відлік на сторінку).
 */
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { PostcardArt } from '@/components/windows/StampArt';
import type { Country, Ms } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';

export type CountdownSceneVariant = 'no-stream' | 'expected';

export interface CountdownSceneProps {
  country: Pick<Country, 'name' | 'flagCode' | 'illustrationId' | 'howTo'>;
  /** Місто або місце («Нуук», «Ейфелева вежа»). Заголовок — «Країна · місто». */
  cityName: string;
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  /** Зсув пояса країни від UTC, хв — для «місцевого часу». */
  offsetMinutes: number;
  /** `no-stream` — трансляції немає зовсім · `expected` — очікується, почнеться сама. */
  variant?: CountdownSceneVariant;
  className?: string;
}

export function CountdownScene({ country, cityName, midnightMs, offsetMinutes, variant = 'no-stream', className }: CountdownSceneProps) {
  const t = useTranslations('player.scene');
  const titleId = useId();
  const now = useNow({ granularity: 'minute' });
  // До гідратації «зараз» невідоме (0): місцевий час не показуємо як справжній.
  const local = now > 0 ? formatClock(now + offsetMinutes * 60_000, { timeZone: 'UTC' }) : '––:––';
  const title = `${country.name.uk} · ${cityName}`;
  const traditions = country.howTo.traditions.slice(0, 3);

  return (
    <section
      aria-labelledby={titleId}
      data-scene={variant}
      className={cn('@container relative size-full min-h-player-min-height overflow-hidden bg-surface-raised', className)}
    >
      <PostcardArt illustrationId={country.illustrationId} fill className="absolute inset-0 size-full" />
      <div className="absolute inset-0 flex flex-col gap-2 bg-linear-to-t from-background/95 via-background/50 to-transparent p-4 @lg:bg-linear-to-r @lg:from-background/80 @lg:via-background/30 @lg:to-transparent @lg:p-8">
        <p className="hidden text-label-sm text-text-secondary @lg:block">{t('caption')}</p>
        <span className="flex-1" />
        <div className="flex items-center gap-3 @lg:gap-5">
          <span className="@lg:hidden">
            <Flag code={country.flagCode} size="md" decorative />
          </span>
          <span className="hidden @lg:block">
            <Flag code={country.flagCode} size="lg" decorative />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-headline-sm text-text @lg:text-headline-lg">
              {title}
            </h2>
            {variant === 'expected' ? (
              <p className="text-caption text-text @lg:text-body">{t('expected')}</p>
            ) : (
              <p className="text-caption text-text @lg:text-body">
                {t.rich('midnightAt', {
                  time: (chunks) => (
                    <time dateTime={new Date(midnightMs).toISOString()} className="font-bold tabular-nums text-highlight">
                      {chunks}
                    </time>
                  ),
                  value: formatClock(midnightMs),
                })}
              </p>
            )}
            {variant === 'expected' ? (
              <p className="text-caption text-text-secondary">{t('expectedNote', { time: local })}</p>
            ) : (
              <>
                <p className="hidden text-caption text-text-secondary @lg:block">{t('localTime', { time: local })}</p>
                <p className="text-caption text-text-secondary @lg:hidden">{t('noStreamNote')}</p>
              </>
            )}
          </div>
        </div>
        {traditions.length > 0 ? (
          <div className="mt-2 hidden flex-col gap-2 @lg:flex">
            <h3 className="text-body-strong text-text">{t('howTo')}</h3>
            <ul className="flex gap-2.5">
              {traditions.map((tr) => (
                <li key={tr.id} className="min-w-0 flex-1 rounded-md border border-border bg-background/70 px-3.5 py-3">
                  <p className="text-label-sm text-text">{tr.title}</p>
                  <p className="mt-0.5 text-caption text-text-secondary">{tr.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
