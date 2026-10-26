'use client';

/**
 * Підказки ТВ.
 * - `TvKeyHints` (під таймлайном): «← → ↑ ↓ вибір · OK відкрити · Назад вийти з режиму вечірки».
 * - `TvFullscreenHint` (у колонці): «Натисни F11 для повного екрана», поки сторінка не в повному екрані
 *   (браузер відхилив повний екран чи його ще не вмикали — стан `fullscreen-denied`).
 */
import { useTranslations } from 'next-intl';
import { useFullscreen } from '@/lib/tv/useTvEnv';
import styles from './tv.module.css';

function Key({ cap, label }: { cap: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden="true" className={styles.keycap}>
        {cap}
      </span>
      {label}
    </span>
  );
}

export function TvKeyHints() {
  const t = useTranslations('tv');
  return (
    <div role="group" aria-label={t('keysLabel')} data-tv-hints="" className={styles.hints}>
      <Key cap={t('keysArrows')} label={t('keysMove')} />
      <Key cap={t('keysOk')} label={t('keysOpen')} />
      <Key cap={t('keysBack')} label={t('keysExit')} />
    </div>
  );
}

export interface TvFullscreenHintProps {
  /** Примусово задати стан повного екрана (історії); за замовчуванням — визначається в браузері. */
  fullscreen?: boolean;
}

export function TvFullscreenHint({ fullscreen }: TvFullscreenHintProps) {
  const tPlayer = useTranslations('player');
  const detected = useFullscreen();
  if (fullscreen ?? detected) return null;
  return (
    <p data-tv-f11="" className="text-tv-text text-text-secondary">
      {tPlayer('f11Hint')}
    </p>
  );
}
