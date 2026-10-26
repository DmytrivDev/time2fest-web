'use client';

/**
 * FacebookConsentCard — стан плеєра `facebook-consent` (C1): Facebook — єдине джерело, а згоди немає.
 * Стоїть на місці відео (у `PlayerSlot`), не поверх. Коралова кнопка «Дозволити» пише
 * `guest.consent.facebookVideo = true`; коралова реєструється в `lib/overlay/coral`, тож кнопка звуку
 * лишається нейтральною (її причина неактивності — у назві кнопки звуку, це справа PlayerBlock).
 * Платформу в підписах не називаємо, окрім самої вимоги згоди (текст з макета).
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/primitives/Icon';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { useGuestStore } from '@/stores/guest';
import { useId } from 'react';

export interface FacebookConsentCardProps {
  /** Викликається після запису згоди (PlayerBlock запускає плеєр). */
  onAllow?: () => void;
  className?: string;
}

export function FacebookConsentCard({ onAllow, className }: FacebookConsentCardProps) {
  const t = useTranslations('player');
  const states = useTranslations('states');
  const titleId = useId();
  const allowed = useGuestStore((s) => s.consent.facebookVideo);
  const setConsent = useGuestStore((s) => s.setConsent);
  useRegisterCoral(!allowed);

  const allow = () => {
    setConsent({ facebookVideo: true });
    onAllow?.();
  };

  return (
    <section
      aria-labelledby={titleId}
      data-consent={allowed ? 'allowed' : 'needed'}
      className={cn(
        'flex size-full min-h-player-min-height flex-col items-center justify-center gap-3 bg-surface px-6 py-4 text-center',
        className,
      )}
    >
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-surface-raised text-text-secondary">
        <Icon name="broadcast-dashed" size={20} />
      </span>
      <h2 id={titleId} className="text-body-strong text-text">
        {t('facebookCard')}
      </h2>
      {allowed ? (
        <p role="status" className="text-caption text-text-secondary">
          {states('loadingStream')}
        </p>
      ) : (
        <Button variant="coral" onClick={allow}>
          {t('facebookAllow')}
        </Button>
      )}
    </section>
  );
}
