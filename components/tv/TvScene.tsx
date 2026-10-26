'use client';

/**
 * TvScene (C22, TV-Countdown): сцена відліку на місці плеєра, коли в поточної події немає трансляції.
 * Стоїть У слоті плеєра (`PlayerSlot fallback`), ніколи поверх відео. Листівка країни, велика назва,
 * відлік `Countdown tv`, «Як святкувати» — частина самої сцени (три традиції). Текст ≥ 22 px.
 * Це ТВ-версія `CountdownScene` з `components/player`: та має розміри під телефон і десктоп (13–16 px).
 */
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { cn } from '@/components/primitives/cn';
import { Countdown } from '@/components/primitives/Countdown';
import { Flag } from '@/components/primitives/Flag';
import { PostcardArt } from '@/components/windows/StampArt';
import type { Country, Ms } from '@/lib/data/types';
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
  const titleId = useId();
  const title = `${country.name.uk} · ${cityName}`;
  const traditions = country.howTo.traditions.slice(0, 3);

  return (
    <section aria-labelledby={titleId} data-scene={variant} data-tv-scene="" className={cn(styles.scene, className)}>
      <PostcardArt illustrationId={country.illustrationId} fill className="absolute inset-0 size-full" />
      <div className={styles.sceneShade}>
        <p className="text-tv-text text-text-secondary">{variant === 'expected' ? t('expected') : t('caption')}</p>
        <div className="flex items-center gap-5">
          <Flag code={country.flagCode} size="lg" decorative />
          <h2 id={titleId} className="text-headline-lg text-text">
            {title}
          </h2>
        </div>
        <div className={styles.sceneCountdown}>
          <Countdown target={midnightMs} variant="tv" label={tTv('countdownTitle', { city: cityName })} />
          <span className="text-tv-text text-text-secondary">{tTv('untilMidnight')}</span>
        </div>
        {traditions.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-tv-title text-highlight">{tTv('howTo')}</h3>
            <ul className={styles.sceneTraditions}>
              {traditions.map((item) => (
                <li key={item.id} className="min-w-0">
                  <strong className="font-bold text-text">{item.title}</strong>
                  <p className="text-tv-text text-text-secondary">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
