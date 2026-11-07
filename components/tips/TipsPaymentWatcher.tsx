'use client';

/**
 * Годинник оплати чайових (часу сайту — машина часу тестової збірки), навіть якщо вікно вже закрито:
 * - «Чекаємо оплату» з `pending` → підтверджено через `TIPS_CONFIRM_MS`;
 * - оплачено, а «Опублікувати тост» не натиснули — публікуємо самі через `TOAST_AUTO_MS` (варіант B, 2026-11-07).
 * Стоїть раз на макет `(live)`.
 */
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { setTipsClock, TIPS_CONFIRM_MS, TOAST_AUTO_MS, useTipsStore } from '@/stores/tips';

export function TipsPaymentWatcher() {
  const t = useTranslations('tips');
  const source = useTimeSource();
  const now = useNow();
  const announce = useAnnounce();
  const pendingSince = useTipsStore((s) => (s.phase === 'paying' ? s.pendingSince : undefined));
  const paidAt = useTipsStore((s) => (s.phase === 'paid' ? s.paidAt : undefined));
  useEffect(() => setTipsClock(() => source.now()), [source]);
  useEffect(() => {
    if (pendingSince === undefined || now - pendingSince < TIPS_CONFIRM_MS) return;
    useTipsStore.getState().confirm();
    announce(t('announcePaid'));
  }, [pendingSince, now, announce, t]);
  useEffect(() => {
    if (paidAt === undefined || now - paidAt < TOAST_AUTO_MS) return;
    useTipsStore.getState().publish();
    announce(t('announceSuccess'));
  }, [paidAt, now, announce, t]);
  return null;
}
