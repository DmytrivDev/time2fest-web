/**
 * Адаптер `sim` домену «Оплата» (`docs/backend/frontend-seam.md`, E4): ОДИН процес замовлення для пасу й тосту замість двох
 * автоматів у `stores/pass.ts` і `stores/toast.ts`. Імітує PayPro Global (перехід на оплату й назад) і вебхук:
 *   start → `open` → через «перехід» (`PAY_ROUNDTRIP_MS`, тост — ще `TOAST_PAY_MS`) результат з тестової панелі
 *   (`testControls.payResult`): `pending` (підтвердження через `PENDING_CONFIRM_MS` часу сайту) | `declined` | `paid`.
 * Результат за продуктом видає «сервер», тобто цей файл: пас — на акаунт; гість без входу в акаунт НЕ входить (рішення
 * власника 2026-11-13) — пас записано на пошту з оплати й працює на цьому пристрої одразу (`grantDevicePass`), а в акаунт
 * потрапляє, коли людина увійде з цією поштою (код чи Google). Тост — у чат «Світ» і серед своїх, тост $10 дарує пас
 * (гостю — після входу на цьому пристрої).
 * Незавершені замовлення (`open`, `pending`) живуть у `localStorage['t2f:orders:v1']` — переживають перезавантаження.
 * Події замовлень ідуть підписникам СИНХРОННО (як вебхук → канал): вікна оновлюються в тому ж такті таймера.
 */
import { fail, ok } from '../result';
import { isFinalOrder, type CheckoutService, type Order, type Product } from '../contracts/checkout';
import { useChatFeed } from '@/lib/chat-sim/store';
import { toastMessage } from '@/lib/chat/toast';
import type { Ms } from '@/lib/data/types';
import { normalizeEmail } from '@/lib/auth/email';
import { PAY_ROUNDTRIP_MS, PENDING_CONFIRM_MS, TOAST_PAY_MS } from '@/lib/offers/paySim';
import { safeGet, safeRemove, safeSet } from '@/lib/storage/safe';
import type { ToastRecord } from '@/lib/toast/feed';
import { tierGiftsPass } from '@/lib/toast/tiers';
import { accountHasPass, useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { useToastStore } from '@/stores/toast';

export const ORDERS_STORAGE_KEY = 't2f:orders:v1';

const orders = new Map<string, Order>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<(o: Order) => void>();
let loaded = false;
let siteNow: () => Ms = () => Date.now();

/** Годинник сайту (машина часу тестової збірки) для «чекаємо підтвердження» і часу тосту. */
export function setCheckoutClock(now: () => Ms): void {
  siteNow = now;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  let saved: Order[] = [];
  try {
    const raw = JSON.parse(safeGet('local', ORDERS_STORAGE_KEY) ?? '[]') as unknown;
    if (Array.isArray(raw)) saved = raw as Order[];
  } catch {
    // пошкоджене сховище — без незавершених оплат
  }
  for (const o of saved) if (o && typeof o.id === 'string' && typeof o.clientId === 'string' && !isFinalOrder(o.status)) orders.set(o.id, o);
}

function save(): void {
  const open = [...orders.values()].filter((o) => !isFinalOrder(o.status));
  if (open.length) safeSet('local', ORDERS_STORAGE_KEY, JSON.stringify(open));
  else safeRemove('local', ORDERS_STORAGE_KEY);
}

function put(o: Order): Order {
  orders.set(o.id, o);
  save();
  listeners.forEach((l) => l(o));
  return o;
}

const roundtrip = (p: Product) => (p.kind === 'toast' ? PAY_ROUNDTRIP_MS + TOAST_PAY_MS : PAY_ROUNDTRIP_MS);

function schedule(id: string, ms: number): void {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      settle(id);
    }, ms),
  );
}

/** «Повернення з PayPro»: результат з тестової панелі. */
function settle(id: string): void {
  const o = orders.get(id);
  if (!o || o.status !== 'open') return;
  const result = useTestControls.getState().payResult;
  if (result === 'pending') put({ ...o, status: 'pending', pendingSince: siteNow(), updatedAt: Date.now() });
  else if (result === 'declined') put({ ...o, status: 'declined', pendingSince: undefined, updatedAt: Date.now() });
  else if (result === 'expired') put({ ...o, status: 'expired', pendingSince: undefined, updatedAt: Date.now() });
  else complete(id);
}

/** «Вебхук: оплачено» — видати результат за продуктом. */
function complete(id: string): void {
  const o = orders.get(id);
  if (!o || isFinalOrder(o.status)) return;
  if (o.product.kind === 'pass') {
    const now = Date.now();
    const auth = useAuthStore.getState();
    if (auth.user) auth.grantPass(auth.user.email, now);
    else auth.grantDevicePass(normalizeEmail(o.email ?? ''), now);
    put({ ...o, status: 'paid', pendingSince: undefined, updatedAt: now });
    return;
  }
  const { tier, text } = o.product;
  const g = useGuestStore.getState();
  const now = siteNow();
  let gift: Order['gift'];
  if (tierGiftsPass(tier) && !accountHasPass(useAuthStore.getState())) gift = { pass: useAuthStore.getState().giftPass(now) };
  const record: ToastRecord = {
    id: `own-${g.id}-${now}`,
    authorId: g.id,
    nick: (g.nick ?? '').trim(),
    flagCode: g.flagCode ?? g.detectedFlag ?? 'earth',
    text: text.trim(),
    tier,
    createdAt: now,
    mine: true,
    pass: accountHasPass(useAuthStore.getState()) || tierGiftsPass(tier),
  };
  useChatFeed.getState().append([toastMessage(record, g.id)]);
  // Свої тости — «стрічка сервера» для цього пристрою (`lib/api/sim/toasts`).
  useToastStore.setState((s) => ({ said: [...s.said, record] }));
  put({ ...o, status: 'paid', pendingSince: undefined, updatedAt: now, toast: record, ...(gift ? { gift } : {}) });
}

/** «Чекаємо підтвердження» → підтверджено, коли минув `PENDING_CONFIRM_MS` часу сайту (`CheckoutSettler`). */
export function confirmDueOrders(now: Ms): Order[] {
  load();
  const done: Order[] = [];
  for (const o of [...orders.values()]) {
    if (o.status !== 'pending' || o.pendingSince === undefined || now - o.pendingSince < PENDING_CONFIRM_MS) continue;
    complete(o.id);
    done.push(orders.get(o.id)!);
  }
  return done;
}

/** Тестова кнопка «підтвердити» (у `http` — вебхук): замовлення вікна з цим `clientId`. */
export function simConfirmOrder(clientId: string): void {
  load();
  for (const o of orders.values()) if (o.clientId === clientId && o.status === 'pending') complete(o.id);
}

/** Після перезавантаження: перерваний «перехід на оплату» довести до результату (без другої оплати). */
export function resumeOpenOrders(): void {
  load();
  for (const o of orders.values()) if (o.status === 'open' && !timers.has(o.id)) schedule(o.id, PAY_ROUNDTRIP_MS);
}

/** Тести: «перезавантаження» вкладки — пам’ять процесу оплати порожня, у сховищі лишились незавершені замовлення. */
export function reloadSimCheckoutForTest(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  orders.clear();
  loaded = false;
}

/** «Скинути стан гостя»: забути замовлення пристрою. */
export function resetSimCheckout(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  orders.clear();
  safeRemove('local', ORDERS_STORAGE_KEY);
}

export function createSimCheckout(): CheckoutService {
  return {
    async start(req) {
      load();
      const same = [...orders.values()].find((o) => o.clientId === req.clientId && !isFinalOrder(o.status));
      if (same) return ok({ order: same, checkoutUrl: '#sim-paypro' });
      if (req.product.kind === 'pass') {
        const email = useAuthStore.getState().user?.email ?? normalizeEmail(req.email ?? '');
        if (useAuthStore.getState().passes[email] !== undefined) return fail('conflict', { reason: 'pass-owned' });
      }
      const now = Date.now();
      const order = put({
        id: `ord-${req.clientId}`,
        clientId: req.clientId,
        product: req.product,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        ...(req.email ? { email: normalizeEmail(req.email) } : {}),
      });
      schedule(order.id, roundtrip(req.product));
      return ok({ order, checkoutUrl: '#sim-paypro' });
    },
    async status(orderId) {
      load();
      // Тестові замовлення для сторінки повернення з PayPro (`/pass/?order=demo-paid` тощо) — лише стан, без наслідків.
      const demo = /^demo-(toast-)?(open|pending|paid|declined|cancelled|expired)$/.exec(orderId);
      if (demo) {
        const now = Date.now();
        const product: Product = demo[1] ? { kind: 'toast', tier: 5, text: 'З Новим роком!' } : { kind: 'pass' };
        return ok({ id: orderId, clientId: orderId, product, status: demo[2] as Order['status'], createdAt: now, updatedAt: now });
      }
      const o = orders.get(orderId);
      return o ? ok(o) : fail('not_found');
    },
    subscribe(onUpdate) {
      listeners.add(onUpdate);
      return () => listeners.delete(onUpdate);
    },
    async cancel(orderId) {
      load();
      const o = orders.get(orderId);
      if (!o) return fail('not_found');
      if (isFinalOrder(o.status)) return ok(o);
      clearTimeout(timers.get(orderId));
      timers.delete(orderId);
      return ok(put({ ...o, status: 'cancelled', pendingSince: undefined, updatedAt: Date.now() }));
    },
    async open() {
      load();
      return ok([...orders.values()].filter((o) => !isFinalOrder(o.status)));
    },
    dev: { setClock: setCheckoutClock, confirm: simConfirmOrder, reset: resetSimCheckout },
  };
}
