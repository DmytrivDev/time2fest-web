'use client';

/**
 * TvControlBar (C22, дошка `TV-Party-New`, рішення 2026-11-06): керування внизу правої колонки — «Звук», «На весь екран»,
 * «Вийти» (іконка будинку: на головну, відео грає далі). Паузи немає (у плеєра YouTube своя; сцена відліку не зупиняється).
 * «На весь екран» — лише відео чи відлік на весь екран, без колонок і таймлайну (власник 2026-11-06; вмикає `TvScreen`).
 * Під кнопками — «Трансляції феєрверків можуть містити спалахи».
 * «Звук» вмикається лише жестом людини (OK на пульті): політика автозапуску браузера.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import styles from './tv.module.css';

export interface TvControlBarProps {
  /** Звук вимкнено. */
  muted: boolean;
  /** Є відео (на сцені відліку звук неактивний). */
  available: boolean;
  onToggleSound?: () => void;
  /** «На весь екран»: лише відео чи відлік. */
  onFullscreen?: () => void;
  className?: string;
}

export function TvControlBar({ muted, available, onToggleSound, onFullscreen, className }: TvControlBarProps) {
  const t = useTranslations('tv');
  const soundOn = available && !muted;

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div role="group" aria-label={t('controls')} data-tv-controls="" className={styles.controlBar}>
        <button
          type="button"
          disabled={!available}
          aria-pressed={soundOn}
          aria-label={soundOn ? t('soundOn') : t('soundOff')}
          onClick={onToggleSound}
          data-action="sound"
          className={cn('t2f-focus t2f-transition', styles.ctrl)}
        >
          <Icon name={soundOn ? 'speaker' : 'speaker-off'} size={22} />
          {t('sound')}
        </button>
        <button type="button" onClick={onFullscreen} data-action="fullscreen" className={cn('t2f-focus t2f-transition', styles.ctrl)}>
          <Icon name="expand" size={22} />
          {t('fullscreen')}
        </button>
        <NextLink href="/" data-action="exit" className={cn('t2f-focus t2f-transition', styles.ctrl)}>
          <Icon name="home" size={22} />
          {t('exit')}
        </NextLink>
      </div>
      <p className={styles.note} data-tv-flash="">
        {t('flashWarning')}
      </p>
    </div>
  );
}
