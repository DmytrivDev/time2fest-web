'use client';

/**
 * «Вебхук PayPro» імітації (`docs/backend/frontend-seam.md`, E4): замість `PassPaymentWatcher` і `ToastPaymentWatcher`.
 * Годинник сайту для замовлень, підтвердження «чекаємо підтвердження» через `PENDING_CONFIRM_MS` часу сайту (машина часу
 * теж рахується) і продовження перерваного «переходу на оплату» після перезавантаження. У `http` це робить сервер.
 */
import { useEffect } from 'react';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { confirmDueOrders, resumeOpenOrders, setCheckoutClock } from './checkout';

export function CheckoutSettler() {
  const source = useTimeSource();
  const now = useNow();
  useEffect(() => setCheckoutClock(() => source.now()), [source]);
  useEffect(() => resumeOpenOrders(), []);
  useEffect(() => {
    if (now) confirmDueOrders(now);
  }, [now]);
  return null;
}
