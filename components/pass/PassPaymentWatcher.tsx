'use client';

/**
 * «Чекаємо підтвердження оплати» пасу → підтверджено через `PASS_CONFIRM_MS` часу сайту (машина часу тестової збірки),
 * навіть якщо вікно вже закрито («Можна закрити — пас увімкнеться сам»). Стоїть раз на макет: `(live)` і `/pass/`.
 */
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { PASS_CONFIRM_MS, setPassClock, usePassStore } from '@/stores/pass';

export function PassPaymentWatcher() {
  const t = useTranslations('pass.announce');
  const source = useTimeSource();
  const now = useNow();
  const announce = useAnnounce();
  const pendingSince = usePassStore((s) => (s.phase === 'pending' ? s.pendingSince : undefined));
  useEffect(() => setPassClock(() => source.now()), [source]);
  useEffect(() => {
    if (pendingSince === undefined || now - pendingSince < PASS_CONFIRM_MS) return;
    usePassStore.getState().confirm();
    announce(t('success'));
  }, [pendingSince, now, announce, t]);
  return null;
}
