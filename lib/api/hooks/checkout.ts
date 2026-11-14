'use client';

/**
 * Хуки домену «Оплата» (`docs/backend/frontend-seam.md`, E4). Старт оплати й стеження вікна за своїм замовленням живуть у
 * сторах вікон (`stores/pass.ts`, `stores/toast.ts`) — вони звертаються до сервісу `checkout` напряму; тут — те, що
 * потрібне компонентам: події своїх замовлень (оголошення «оплату підтверджено», коли вікно вже закрите).
 */
import { useEffect, useRef, useState } from 'react';
import { isFinalOrder, type Order, type OrderStatus } from '../contracts/checkout';
import { getService } from '../services';

/** Кожна зміна свого замовлення; `prev` — попередній статус, який бачила ця вкладка (`undefined` — уперше). */
export function useOrderUpdates(onUpdate: (order: Order, prev: OrderStatus | undefined) => void): void {
  const cb = useRef(onUpdate);
  useEffect(() => {
    cb.current = onUpdate;
  });
  useEffect(() => {
    const seen = new Map<string, OrderStatus>();
    const svc = getService('checkout');
    const off = svc.subscribe((o) => {
      const prev = seen.get(o.id);
      seen.set(o.id, o.status);
      cb.current(o, prev);
    });
    // Після перезавантаження: незавершені замовлення вже «бачені» (оплата, що чекала, — `pending`).
    void svc.open().then((res) => {
      if (res.ok) for (const o of res.value) if (!seen.has(o.id)) seen.set(o.id, o.status);
    });
    return off;
  }, []);
}

/** Що з замовленням після повернення з PayPro (`?order=`). */
export type OrderReturnState = {
  kind: 'checking' | 'pending' | 'paid' | 'declined' | 'cancelled' | 'expired' | 'slow' | 'failed' | 'missing';
  order?: Order;
};

/** Опитування після повернення: 1 → 2 → 5 с, далі по 5 с, усього до 2 хв (`frontend-seam.md`, 3.5). */
export const ORDER_POLL_MS = [1_000, 2_000, 5_000] as const;
export const ORDER_POLL_LIMIT_MS = 120_000;

/**
 * Повернення з PayPro: опитує `status(orderId)` і слухає свої замовлення — що прийде першим. Кінцевий статус —
 * стоп; 2 хв без кінцевого — `slow` (усе ще `pending`) або `failed` (жодної відповіді, мережа); `not_found` — `missing`.
 */
export function useOrderReturn(orderId: string): { state: OrderReturnState; retry: () => void } {
  const [state, setState] = useState<OrderReturnState>({ kind: 'checking' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const svc = getService('checkout');
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempt = 0;
    let last: Order | undefined;
    const apply = (o: Order) => {
      last = o;
      if (isFinalOrder(o.status)) {
        stopped = true;
        clearTimeout(timer);
        setState({ kind: o.status as OrderReturnState['kind'], order: o });
      } else setState({ kind: o.status === 'pending' ? 'pending' : 'checking', order: o });
    };
    const off = svc.subscribe((o) => {
      if (o.id === orderId && !stopped) apply(o);
    });
    const poll = async () => {
      if (stopped) return;
      const res = await svc.status(orderId);
      if (stopped) return;
      if (res.ok) apply(res.value);
      else if (res.error.code === 'not_found') {
        stopped = true;
        setState({ kind: 'missing' });
        return;
      }
      if (stopped) return;
      const delay = ORDER_POLL_MS[Math.min(attempt, ORDER_POLL_MS.length - 1)]!;
      attempt += 1;
      if (Date.now() - started + delay > ORDER_POLL_LIMIT_MS) {
        stopped = true;
        setState(last ? { kind: 'slow', order: last } : { kind: 'failed' });
        return;
      }
      timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      off();
    };
  }, [orderId, round]);
  return {
    state,
    retry: () => {
      setState({ kind: 'checking' });
      setRound((r) => r + 1);
    },
  };
}
