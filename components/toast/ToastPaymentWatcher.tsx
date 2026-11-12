'use client';

/**
 * Годинник оплати тосту (часу сайту — машина часу тестової збірки), навіть якщо вікно вже закрито: «Чекаємо оплату»
 * з `pending` → підтверджено через `TOAST_CONFIRM_MS` → тост одразу в чаті «Світ» і в смузі (рішення власника
 * 2026-11-12). Стоїть раз на макет `(live)`. Після монтування відновлює свої тости й незавершену оплату зі сховища.
 */
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { resumeToastFlow, setToastClock, TOAST_CONFIRM_MS, useToastStore } from '@/stores/toast';

export function ToastPaymentWatcher() {
  const t = useTranslations('toast');
  const source = useTimeSource();
  const now = useNow();
  const announce = useAnnounce();
  const pendingSince = useToastStore((s) => (s.phase === 'paying' ? s.pendingSince : undefined));
  useEffect(() => setToastClock(() => source.now()), [source]);
  useEffect(() => {
    void resumeToastFlow();
  }, []);
  useEffect(() => {
    if (pendingSince === undefined || now - pendingSince < TOAST_CONFIRM_MS) return;
    useToastStore.getState().confirm();
    announce(t('announcePaid'));
  }, [pendingSince, now, announce, t]);
  return null;
}
