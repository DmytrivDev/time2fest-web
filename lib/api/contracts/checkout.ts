/**
 * Контракт домену «Оплата» (`docs/backend/frontend-seam.md`): ОДИН асинхронний процес для пасу й тосту замість двох
 * автоматів станів (`stores/pass.ts`, `stores/toast.ts` над `lib/offers/paySim.ts`).
 *
 * start → перехід на сторінку оплати PayPro Global (hosted checkout) → повернення на `returnPath` → статус замовлення:
 * опитуванням `status()` і/або realtime `subscribe()`, яке живить вебхук PayPro (перевірка підпису на сервері).
 * Сервер, а не клієнт, видає пас, публікує тост і дарує пас за тост $10. Клієнт лише показує стан замовлення.
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { Ms } from '@/lib/data/types';
import type { ToastRecord } from '@/lib/toast/feed';
import type { ToastTier } from '@/lib/toast/tiers';

export type Product = { kind: 'pass' } | { kind: 'toast'; tier: ToastTier; text: string };

export interface CheckoutStartRequest {
  product: Product;
  /**
   * Гість без входу: пошта для акаунта й квитанції (акаунт створює сервер після оплати й шле посилання для входу).
   * Той, хто увійшов, пошту не передає — береться з сесії.
   */
  email?: string;
  /** Куди PayPro поверне людину (шлях сайту; сервер додає `?order=<id>`). */
  returnPath: string;
  /** Ідемпотентність: повторне натискання «Оплатити» не створює друге замовлення. */
  clientId: string;
}

export type OrderStatus =
  /** Створено, людина ще на сторінці оплати. */
  | 'open'
  /** PayPro прийняв, чекаємо підтвердження (банк, 3-D Secure). */
  | 'pending'
  | 'paid'
  | 'declined'
  /** Людина скасувала чи закрила оплату. */
  | 'cancelled'
  /** Не оплачено за відведений час. */
  | 'expired';

export interface Order {
  id: string;
  /** `clientId` із `start` — вікно впізнає своє замовлення в особистому каналі. */
  clientId: string;
  product: Product;
  status: OrderStatus;
  /** Відколи «чекаємо підтвердження» (`pending`). */
  pendingSince?: Ms;
  createdAt: Ms;
  updatedAt: Ms;
  /** Пошта, на яку оформлено (гість). */
  email?: string;
  /** Пас у подарунок до тосту $10: `active` — на акаунті; `pending` — чекає входу з цією поштою. */
  gift?: { pass: 'active' | 'pending' };
  /** Тост, опублікований після оплати. */
  toast?: ToastRecord;
}

export interface CheckoutSession {
  order: Order;
  /** Сторінка оплати PayPro Global (повний URL) — `location.assign`. */
  checkoutUrl: string;
}

/**
 * Помилки `start`: `conflict` з `reason: 'pass-owned'` (на цю пошту/акаунт пас уже є — показати «увійти»),
 * `validation` з `reason` фільтра тосту, `rate_limited`, `unavailable` (оплати вимкнено), `network`.
 */
export interface CheckoutService {
  /** `POST /api/checkout`. */
  start(req: CheckoutStartRequest): Promise<ApiResult<CheckoutSession>>;
  /** `GET /api/orders/:id` — опитування після повернення з PayPro. */
  status(orderId: string): Promise<ApiResult<Order>>;
  /** Realtime: особистий канал `orders:user#<userId>` — зміни ВСІХ своїх замовлень (події з вебхука PayPro). */
  subscribe(onUpdate: (order: Order) => void): Unsubscribe;
  /** «Скасувати» до оплати. `POST /api/orders/:id/cancel`. */
  cancel(orderId: string): Promise<ApiResult<Order>>;
  /** Незавершені замовлення цього гостя чи акаунта — довести до кінця після перезавантаження. `GET /api/me/orders?open=1`. */
  open(): Promise<ApiResult<readonly Order[]>>;
}

/** Кінцеві стани: після них опитування припиняється. */
export function isFinalOrder(status: OrderStatus): boolean {
  return status === 'paid' || status === 'declined' || status === 'cancelled' || status === 'expired';
}
