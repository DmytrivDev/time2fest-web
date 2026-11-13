'use client';

/**
 * «Сервер» імітації, що працює у вкладці: усе, що в `http` робитиме бекенд сам, без запиту від інтерфейсу
 * (`docs/backend/frontend-seam.md`). Домени додають сюди свої генератори під час перенесення: штампи за присутність,
 * підтвердження оплати PayPro, імітовані оцінки й тости світу.
 */
import { NotificationsGenerator } from './NotificationsGenerator';
import { RatingTicker } from './RatingTicker';

/** Домени «сервера» імітації; `ApiRuntime` без списку монтує всі (макет `(live)`), `/tv` — лише потрібні йому. */
export type SimDomain = 'notifications' | 'rating';

export function SimRuntime({ only }: { only?: readonly SimDomain[] }) {
  const on = (d: SimDomain) => !only || only.includes(d);
  return (
    <>
      {on('notifications') ? <NotificationsGenerator /> : null}
      {on('rating') ? <RatingTicker /> : null}
    </>
  );
}
