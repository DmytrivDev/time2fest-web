'use client';

/**
 * Повернення на сайт із чужої сторінки (стани для справжнього сервера, рішення власника 2026-11-13 «малюємо»):
 *   • `?order=<id>` — повернення з PayPro: опитуємо статус замовлення (1 → 2 → 5 с, до 2 хв) і слухаємо канал;
 *     смуга «Перевіряємо оплату…» → «Оплату підтверджено» / «не пройшла» / «час минув» / «ще обробляється» /
 *     «не вдалося перевірити» (з «Перевірити ще»). Вікно пасу чи тосту, з якого пішли платити, саме бачить своє
 *     замовлення (`stores/pass`, `stores/toast` → `PaymentWatcher`), тож смуга — лише пояснення, що сталося.
 *   • `?signin=google` (і `&error=…`) — повернення з Google: «Завершуємо вхід…» → «Ти увійшов» / «не завершено».
 * Обидві — спокійна смуга в потоці сторінки (як «Немає з’єднання»), не поверх відео. Параметр прибираємо з адреси одразу.
 * У `sim`: `/pass/?order=demo-paid` (`demo-pending`, `demo-declined`, `demo-expired`, `demo-cancelled`, `demo-toast-paid`),
 * затримка — `&simDelay=checkout.status:60000`, мережа — `&simFail=checkout.status:network`; Google — `/?signin=google`,
 * `/?signin=google&error=cancelled`, «завершуємо» — `&simDelay=auth.session:5000`.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { IconButton } from '@/components/primitives/IconButton';
import { StatusMessage, type StatusKind } from '@/components/primitives/StatusMessage';
import { authActions } from '@/lib/api/hooks/auth';
import { useOrderReturn, type OrderReturnState } from '@/lib/api/hooks/checkout';
import { rememberReturn } from '@/lib/auth/returnTo';

/** Прочитати й прибрати параметр з адреси (раз після монтування — статичний експорт не знає параметрів). */
function takeParams(names: readonly string[]): Record<string, string> | null {
  const url = new URL(window.location.href);
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = url.searchParams.get(n);
    if (v !== null) out[n] = v;
    url.searchParams.delete(n);
  }
  if (!Object.keys(out).length) return null;
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return out;
}

function Strip({ kind, children, action, onClose, data }: { kind: StatusKind; children: React.ReactNode; action?: React.ReactNode; onClose?: () => void; data: string }) {
  const t = useTranslations('common');
  return (
    <div className="px-4 pt-3" data-return-notice={data}>
      <StatusMessage
        kind={kind}
        className="mx-auto max-w-content-max"
        action={onClose ? <IconButton aria-label={t('close')} icon="close" onClick={onClose} /> : undefined}
      >
        {/* Дія («Перевірити ще», «Увійти») — у рядку тексту: на телефоні смуга не стискає текст у вузьку колонку. */}
        {children}
        {action ? <> {action}</> : null}
      </StatusMessage>
    </div>
  );
}

const KIND: Record<OrderReturnState['kind'], StatusKind> = {
  checking: 'info',
  pending: 'info',
  paid: 'success',
  declined: 'error',
  cancelled: 'info',
  expired: 'error',
  slow: 'info',
  failed: 'offline',
  missing: 'error',
};

function OrderNotice({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const t = useTranslations('pay.return');
  const { state, retry } = useOrderReturn(orderId);
  const toast = state.order?.product.kind === 'toast';
  const key = state.kind === 'paid' ? (toast ? 'paidToast' : 'paidPass') : state.kind;
  const final = state.kind !== 'checking' && state.kind !== 'pending';
  return (
    <Strip
      kind={KIND[state.kind]}
      data={`order-${state.kind}`}
      onClose={final ? onClose : undefined}
      action={
        state.kind === 'failed' ? (
          <button type="button" onClick={retry} className="t2f-focus text-body-strong underline">
            {t('retry')}
          </button>
        ) : state.kind === 'missing' ? (
          <NextLink href="/help/" className="t2f-focus text-body-strong underline">
            {t('help')}
          </NextLink>
        ) : undefined
      }
    >
      {t(key)}
    </Strip>
  );
}

type GoogleState = 'checking' | 'ok' | 'failed';

function GoogleNotice({ error, onClose }: { error: string | undefined; onClose: () => void }) {
  const t = useTranslations('auth.google');
  const [state, setState] = useState<GoogleState>(error ? 'failed' : 'checking');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (error) return;
    let alive = true;
    // Свіжа сесія від сервісу (а не кеш): після переходу cookie вже поставив сервер.
    void authActions.session().then((res) => {
      if (!alive) return;
      const user = res.ok ? res.value.user : null;
      setEmail(user?.email ?? '');
      setState(user ? 'ok' : 'failed');
    });
    return () => {
      alive = false;
    };
  }, [error]);
  if (state === 'checking')
    return (
      <Strip kind="info" data="google-checking">
        {t('returning')}
      </Strip>
    );
  if (state === 'ok')
    return (
      <Strip kind="success" data="google-ok" onClose={onClose}>
        {t('returned', { email })}
      </Strip>
    );
  return (
    <Strip
      kind="error"
      data="google-failed"
      onClose={onClose}
      action={
        <NextLink
          href="/login/"
          onClick={() => rememberReturn(window.location.pathname + window.location.search)}
          className="t2f-focus text-body-strong underline"
        >
          {t('returnRetry')}
        </NextLink>
      }
    >
      {t('returnFailed')}
    </Strip>
  );
}

/** Смуги повернення з PayPro і Google; ставиться раз на макет (як `OfflineNotice`). */
export function ReturnNotice() {
  const [ret, setRet] = useState<{ order?: string; google?: { error?: string } } | null>(null);
  useEffect(() => {
    const p = takeParams(['order', 'signin', 'error']);
    if (!p) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- одноразово після монтування: параметри адреси (статичний експорт)
    setRet({
      ...(p.order ? { order: p.order } : {}),
      ...(p.signin === 'google' ? { google: { error: p.error } } : {}),
    });
  }, []);
  if (!ret) return null;
  return (
    <>
      {ret.google ? <GoogleNotice error={ret.google.error} onClose={() => setRet((r) => (r ? { ...r, google: undefined } : r))} /> : null}
      {ret.order ? <OrderNotice orderId={ret.order} onClose={() => setRet((r) => (r ? { ...r, order: undefined } : r))} /> : null}
    </>
  );
}
