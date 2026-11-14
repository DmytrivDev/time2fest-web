'use client';

/**
 * TvScene (C22, дошка `TV-Party-New` «7 · Сцена відліку»): сцена відліку на місці плеєра, коли в поточної події немає
 * трансляції. Стоїть У слоті плеєра (`PlayerSlot fallback`), ніколи поверх відео. «Лише відлік · сцена Time2Fest»,
 * листівка-штамп у куті, прапор і «Країна · місто», великий відлік, «до півночі · 03:00 за вашим часом»,
 * унизу — «Як святкувати» (три традиції з іконками, як на сторінці країни).
 */
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { HowToCard } from '@/components/live/HowToCard';
import { cn } from '@/components/primitives/cn';
import { Countdown } from '@/components/primitives/Countdown';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Fireworks } from '@/components/player/Fireworks';
import { midnightPhase } from '@/components/player/SceneMidnight';
import { PostcardArt } from '@/components/stamp/StampArt';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { arrivedYear } from '@/lib/engine/newYear';
import type { Country, Ms } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import styles from './tv.module.css';

export interface TvSceneProps {
  country: Pick<Country, 'name' | 'flagCode' | 'illustrationId' | 'howTo'>;
  /** Місто або місце («Прая»). Заголовок — «Країна · місто». */
  cityName: string;
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  /** Зсув пояса країни від UTC, хв — для року в «зустрічає 2027» (немає — рік за UTC). */
  offsetMinutes?: number;
  /** `no-stream` — трансляції немає зовсім · `expected` — очікується, почнеться сама. */
  variant?: 'no-stream' | 'expected';
  className?: string;
}

export function TvScene({ country, cityName, midnightMs, offsetMinutes = 0, variant = 'no-stream', className }: TvSceneProps) {
  const t = useTranslations('player.scene');
  const tTv = useTranslations('tv');
  const locale = useLocale();
  const titleId = useId();
  const title = `${country.name.uk} · ${cityName}`;
  const traditions = country.howTo.traditions.slice(0, 3);
  // Північ, як на головній (home.md «мить»): з півночі відліку немає — «З Новим роком!» із салютом, далі на місці
  // відліку — рік, що настав («2027», рішення 2026-11-14).
  const now = useNow({ granularity: 'second' });
  const reduced = useReducedMotion();
  const phase = midnightPhase(midnightMs, now);
  const celebrate = phase.kind === 'celebrate';
  const past = celebrate || phase.kind === 'after';
  const year = arrivedYear(midnightMs, offsetMinutes);

  return (
    <section aria-labelledby={titleId} data-scene={variant} data-tv-scene="" className={cn(styles.scene, className)}>
      <span aria-hidden="true" className={styles.scenePostcard}>
        <PostcardArt illustrationId={country.illustrationId} className="block w-full rounded-sm" />
      </span>
      {celebrate && !reduced ? <Fireworks elapsedMs={phase.since} className="pointer-events-none absolute inset-0 size-full" /> : null}
      <div className={styles.sceneTop}>
        <span className={styles.sceneChip}>
          <Icon name="clock" size={16} />
          {variant === 'expected' ? t('expected') : tTv('sceneChip')}
        </span>
        <div className="flex items-center gap-3.5">
          <Flag code={country.flagCode} size="lg" decorative />
          <h2 id={titleId} className={styles.sceneTitle}>
            {title}
          </h2>
        </div>
        {celebrate ? (
          <div className={styles.sceneTimer} data-scene-celebrate="" role="status">
            <p className="text-highlight" style={{ fontSize: 'var(--text-countdown-inline)', fontWeight: 800 }}>
              {t('happyNewYear')}
            </p>
            <p className={styles.sceneWhen}>{t('celebrateLine', { place: title, year })}</p>
          </div>
        ) : past ? (
          // Після салюту — рік, що настав, на місці відліку (рішення власника 2026-11-14): той самий блок і кегль.
          <>
            <div className={styles.sceneTimer}>
              <div>
                <p className={styles.sceneYear} data-tv-scene-year={year}>
                  {year}
                </p>
              </div>
            </div>
            <p className={styles.sceneWhen}>{tTv.rich('sceneYearWhen', { time: formatClock(midnightMs, { locale }), b: (c) => <b className="text-text">{c}</b> })}</p>
          </>
        ) : (
          <>
            <div className={styles.sceneTimer}>
              <Countdown target={midnightMs} variant="tv" label={tTv('countdownTitle', { city: cityName })} />
            </div>
            <p className={styles.sceneWhen}>{tTv.rich('sceneWhen', { time: formatClock(midnightMs, { locale }), b: (c) => <b className="text-text">{c}</b> })}</p>
          </>
        )}
      </div>
      {traditions.length ? <HowToCard country={country.name.uk} traditions={traditions} variant="tv" headingLevel="h3" className={styles.sceneHow} /> : null}
    </section>
  );
}
