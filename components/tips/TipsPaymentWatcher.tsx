'use client';

/**
 * «Чекаємо підтвердження оплати» чайових → підтверджено через `TIPS_CONFIRM_MS` часу сайту (машина часу тестової збірки),
 * навіть якщо вікно вже закрито («Можна закрити — тост з’явиться в чаті сам»). Стоїть раз на макет `(live)`.
 */
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { setTipsClock, TIPS_CONFIRM_MS, useTipsStore } from '@/stores/tips';

export function TipsPaymentWatcher() {
  const t = useTranslations('tips');
  const source = useTimeSource();
  const now = useNow();
  const announce = useAnnounce();
  const pendingSince = useTipsStore((s) => (s.phase === 'pending' ? s.pendingSince : undefined));
  useEffect(() => setTipsClock(() => source.now()), [source]);
  useEffect(() => {
    if (pendingSince === undefined || now - pendingSince < TIPS_CONFIRM_MS) return;
    useTipsStore.getState().confirm();
    announce(t('announceSuccess'));
  }, [pendingSince, now, announce, t]);
  return null;
}
