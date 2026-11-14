'use client';

/**
 * Одне стеження за оплатами (шов E4, замість `PassPaymentWatcher` і `ToastPaymentWatcher`): після монтування відновлює
 * вікна пасу й тосту зі сховища (незавершена оплата переживає перезавантаження), а коли «чекаємо підтвердження»
 * стає «оплачено» — оголошує це для читачів екрана, навіть якщо вікно вже закрите. Саме підтвердження — справа сервера
 * (у `sim` — `CheckoutSettler` у `SimRuntime`). Стоїть раз на макет: `(live)` і `/pass/`.
 */
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useOrderUpdates } from '@/lib/api/hooks/checkout';
import { resumePassFlow } from '@/stores/pass';
import { resumeToastFlow } from '@/stores/toast';

export function PaymentWatcher() {
  const tPass = useTranslations('pass.announce');
  const tToast = useTranslations('toast');
  const announce = useAnnounce();
  useEffect(() => {
    void resumePassFlow();
    void resumeToastFlow();
  }, []);
  useOrderUpdates((o, prev) => {
    if (o.status !== 'paid' || prev !== 'pending') return;
    announce(o.product.kind === 'pass' ? tPass('success') : tToast('announcePaid'));
  });
  return null;
}
