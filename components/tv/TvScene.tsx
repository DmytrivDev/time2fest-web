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
import { PostcardArt } from '@/components/windows/StampArt';
import type { Country, Ms } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import styles from './tv.module.css';

export interface TvSceneProps {
  country: Pick<Country, 'name' | 'flagCode' | 'illustrationId' | 'howTo'>;
  /** Місто або місце («Прая»). Заголовок — «Країна · місто». */
  cityName: string;
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  /** `no-stream` — трансляції немає зовсім · `expected` — очікується, почнеться сама. */
  variant?: 'no-stream' | 'expected';
  className?: string;
}

export function TvScene({ country, cityName, midnightMs, variant = 'no-stream', className }: TvSceneProps) {
  const t = useTranslations('player.scene');
  const tTv = useTranslations('tv');
  const locale = useLocale();
  const titleId = useId();
  const title = `${country.name.uk} · ${cityName}`;
  const traditions = country.howTo.traditions.slice(0, 3);

  return (
    <section aria-labelledby={titleId} data-scene={variant} data-tv-scene="" className={cn(styles.scene, className)}>
      <span aria-hidden="true" className={styles.scenePostcard}>
        <PostcardArt illustrationId={country.illustrationId} className="block w-full rounded-sm" />
      </span>
      <div className={styles.sceneTop}>
        <span className={styles.sceneChip}>
          <Icon name="clock" size={16} />
          {variant === 'expected' ? t('expected') : tTv('sceneChip')}
        </span>
        <div className="flex items-center gap-3.5">
          <Flag code={country.flagCode} size="lg" round decorative />
          <h2 id={titleId} className={styles.sceneTitle}>
            {title}
          </h2>
        </div>
        <div className={styles.sceneTimer}>
          <Countdown target={midnightMs} variant="tv" label={tTv('countdownTitle', { city: cityName })} />
        </div>
        <p className={styles.sceneWhen}>{tTv.rich('sceneWhen', { time: formatClock(midnightMs, { locale }), b: (c) => <b className="text-text">{c}</b> })}</p>
      </div>
      {traditions.length ? <HowToCard country={country.name.uk} traditions={traditions} variant="tv" headingLevel="h3" className={styles.sceneHow} /> : null}
    </section>
  );
}
