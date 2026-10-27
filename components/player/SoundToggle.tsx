'use client';

/**
 * SoundToggle — «Увімкнути звук» у рядку дій плеєра (C1 ActionRow, FR-003, ІНВ 5.3).
 * - коралова, поки звук вимкнено; щойно на екрані відкрите вікно з власною кораловою кнопкою
 *   (`lib/overlay/coral`) — нейтральна (правило однієї коралової кнопки);
 * - звук вмикається лише жестом людини (`unmute()` у обробнику кліку), у тому самому плеєрі;
 * - відео немає (сцена відліку, картка Facebook) — кнопка неактивна, причина в доступній назві;
 * - телефон: лише іконка 44×44 (назва в `aria-label`), від 768 px — з підписом.
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';

export interface SoundToggleProps {
  muted: boolean;
  /** Є відео, у якому можна ввімкнути звук. */
  available: boolean;
  onUnmute?: () => void;
  onMute?: () => void;
  className?: string;
}

export function SoundToggle({ muted, available, onUnmute, onMute, className }: SoundToggleProps) {
  const t = useTranslations('player');
  const on = available && !muted;
  const label = !available ? t('soundUnavailable') : on ? t('soundIsOn') : t('soundOn');
  const text = on ? t('soundIsOn') : t('soundOn');

  return (
    <Button
      variant={on ? 'secondary' : 'coral'}
      yieldToCoralWindow
      disabled={!available}
      aria-label={label}
      data-sound={!available ? 'unavailable' : on ? 'on' : 'off'}
      onClick={() => (on ? onMute?.() : onUnmute?.())}
      className={cn('max-md:size-touch-min max-md:px-0', className)}
    >
      {/* Макети: телефон — 44×44 з іконкою 20 (вимкнено — перекреслений динамік); ширше — динамік із хвилями 18 + підпис. */}
      <Icon name={on ? 'speaker' : 'speaker-off'} size={20} strokeWidth={2} className="md:hidden" />
      <Icon name="speaker" size={18} strokeWidth={2} className="max-md:hidden" />
      <span aria-hidden="true" className="max-md:hidden">
        {text}
      </span>
    </Button>
  );
}
