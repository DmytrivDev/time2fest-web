'use client';

/**
 * TvControlBar (C22): смуга керування внизу бічної колонки, стиль `player-frame-bar` — «Пауза», «Звук», «Вийти».
 * Стоїть у колонці, ніколи на відео. Під смугою — «Трансляції феєрверків можуть містити спалахи».
 * «Звук» вмикається лише жестом людини (OK на пульті): політика автозапуску браузера.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import styles from './tv.module.css';

export interface TvControlBarProps {
  /** Відео на паузі (кнопка стає «Грати»). */
  paused: boolean;
  /** Звук вимкнено. */
  muted: boolean;
  /** Є відео, яким можна керувати (на сцені відліку пауза й звук неактивні). */
  available: boolean;
  onTogglePause?: () => void;
  onToggleSound?: () => void;
  className?: string;
}

export function TvControlBar({ paused, muted, available, onTogglePause, onToggleSound, className }: TvControlBarProps) {
  const t = useTranslations('tv');
  const soundOn = available && !muted;
  return (
    <div role="group" aria-label={t('controls')} data-tv-controls="" className={cn(styles.controlBar, className)}>
      <Button variant="tonal" size="tv" iconLeft={paused ? 'play' : 'pause'} disabled={!available} onClick={onTogglePause} data-action="pause">
        {paused ? t('play') : t('pause')}
      </Button>
      <Button
        variant="tonal"
        size="tv"
        iconLeft={soundOn ? 'speaker' : 'speaker-off'}
        disabled={!available}
        aria-pressed={soundOn}
        aria-label={soundOn ? t('soundOn') : t('soundOff')}
        onClick={onToggleSound}
        data-action="sound"
      >
        {t('sound')}
      </Button>
      <Button asChild variant="secondary" size="tv">
        <NextLink href="/" data-action="exit">
          {t('exit')}
        </NextLink>
      </Button>
    </div>
  );
}
