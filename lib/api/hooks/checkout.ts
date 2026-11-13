'use client';

/**
 * Хуки домену «Оплата» (`docs/backend/frontend-seam.md`, E4). Старт оплати й стеження вікна за своїм замовленням живуть у
 * сторах вікон (`stores/pass.ts`, `stores/toast.ts`) — вони звертаються до сервісу `checkout` напряму; тут — те, що
 * потрібне компонентам: події своїх замовлень (оголошення «оплату підтверджено», коли вікно вже закрите).
 */
import { useEffect, useRef } from 'react';
import type { Order, OrderStatus } from '../contracts/checkout';
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
