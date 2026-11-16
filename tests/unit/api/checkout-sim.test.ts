/** Шов E4: один процес оплати для пасу й тосту (`lib/api/sim/checkout`) і стрічка тостів (`lib/api/sim/toasts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/lib/api/contracts/checkout';
import { confirmDueOrders, createSimCheckout, reloadSimCheckoutForTest, resetSimCheckout, resumeOpenOrders, setCheckoutClock } from '@/lib/api/sim/checkout';
import { createSimToasts } from '@/lib/api/sim/toasts';
import { useChatFeed } from '@/lib/chat-sim/store';
import { PAY_ROUNDTRIP_MS, PAYPRO_DEMO_EMAIL, PENDING_CONFIRM_MS, TOAST_PAY_MS } from '@/lib/offers/paySim';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { useToastStore } from '@/stores/toast';

const T0 = Date.UTC(2026, 11, 31, 20, 0, 0);
const svc = createSimCheckout();
let seen: Order[] = [];
let off: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetSimCheckout();
  setCheckoutClock(() => Date.now());
  useAuthStore.setState({ user: null, accounts: [], code: null, devicePass: null, sends: [], passes: {} });
  useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
  useToastStore.setState({ said: [] });
  useChatFeed.getState().reset();
  useTestControls.getState().setPayResult('success');
  seen = [];
  off = svc.subscribe((o) => seen.push(o));
});
afterEach(() => {
  off();
  useTestControls.getState().setPayResult('success');
  vi.useRealTimers();
});

describe('процес оплати (sim)', () => {
  it('пас гостя: open → оплачено після переходу; гість НЕ входить (рішення 2026-11-13) — пас на пошті й на пристрої', async () => {
    const res = await svc.start({ product: { kind: 'pass' }, email: ' Olena@Example.com ', returnPath: '/pass/', clientId: 'c1' });
    expect(res.ok && res.value.order).toMatchObject({ status: 'open', clientId: 'c1', email: 'olena@example.com' });
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS);
    expect(seen.at(-1)?.status).toBe('paid');
    expect(useAuthStore.getState().user).toBeNull();
    // Пас записано на пошту оплати як неприєднаний: до акаунта — першим входом з нею (рішення 2026-11-14).
    expect(useAuthStore.getState().unclaimed['olena@example.com']?.since).toBe(T0 + PAY_ROUNDTRIP_MS);
    expect(useAuthStore.getState().devicePass).toMatchObject({ email: 'olena@example.com', since: T0 + PAY_ROUNDTRIP_MS });
  });

  it('повернення з PayPro: тестові замовлення demo-* для сторінки повернення', async () => {
    expect(await svc.status('demo-expired')).toMatchObject({ ok: true, value: { status: 'expired', product: { kind: 'pass' } } });
    expect(await svc.status('demo-toast-paid')).toMatchObject({ ok: true, value: { status: 'paid', product: { kind: 'toast' } } });
    expect(await svc.status('nope')).toEqual({ ok: false, error: { code: 'not_found' } });
  });

  it('той самий clientId — те саме замовлення; пошта з пасом — conflict pass-owned', async () => {
    const a = await svc.start({ product: { kind: 'pass' }, email: 'a@b.co', returnPath: '/', clientId: 'same' });
    const b = await svc.start({ product: { kind: 'pass' }, email: 'a@b.co', returnPath: '/', clientId: 'same' });
    expect(a.ok && b.ok && a.value.order.id === b.value.order.id).toBe(true);
    useAuthStore.setState({ passes: { 'x@y.co': 1 } });
    expect(await svc.start({ product: { kind: 'pass' }, email: 'x@y.co', returnPath: '/', clientId: 'c2' })).toEqual({ ok: false, error: { code: 'conflict', reason: 'pass-owned' } });
  });

  it('«чекаємо підтвердження» → оплачено через PENDING_CONFIRM_MS часу сайту; відмова — declined без результату', async () => {
    useTestControls.getState().setPayResult('pending');
    useAuthStore.getState().signInVerified('olena@example.com', T0);
    await svc.start({ product: { kind: 'pass' }, returnPath: '/', clientId: 'p' });
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS);
    expect(seen.at(-1)).toMatchObject({ status: 'pending', pendingSince: T0 + PAY_ROUNDTRIP_MS });
    expect(confirmDueOrders(T0 + PAY_ROUNDTRIP_MS + PENDING_CONFIRM_MS - 1)).toEqual([]);
    confirmDueOrders(T0 + PAY_ROUNDTRIP_MS + PENDING_CONFIRM_MS);
    expect(seen.at(-1)?.status).toBe('paid');
    useTestControls.getState().setPayResult('declined');
    await svc.start({ product: { kind: 'toast', tier: 5, text: 'Ура' }, returnPath: '/', clientId: 'd' });
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS + TOAST_PAY_MS);
    expect(seen.at(-1)?.status).toBe('declined');
    expect(useToastStore.getState().said).toEqual([]);
  });

  it('тост $10 гостя: у чаті «Світ», серед своїх, пас у подарунок одразу на пристрої з поштою PayPro', async () => {
    await svc.start({ product: { kind: 'toast', tier: 10, text: 'За всіх!' }, returnPath: '/', clientId: 't' });
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS + TOAST_PAY_MS);
    const paid = seen.at(-1)!;
    expect(paid).toMatchObject({ status: 'paid', email: PAYPRO_DEMO_EMAIL, gift: { pass: 'device' }, toast: { text: 'За всіх!', tier: 10, nick: 'Олена', mine: true } });
    expect(useToastStore.getState().said.map((t) => t.id)).toEqual([paid.toast!.id]);
    expect(useChatFeed.getState().rooms.world?.some((m) => m.toast?.amount === 10)).toBe(true);
    expect(useAuthStore.getState().devicePass).toMatchObject({ email: PAYPRO_DEMO_EMAIL, since: T0 + PAY_ROUNDTRIP_MS + TOAST_PAY_MS });
    expect(useAuthStore.getState().unclaimed[PAYPRO_DEMO_EMAIL]).toBeDefined();
  });

  it('тост у чатах країн, де його сказано: один тост, повідомлення у «Світі» й у кожній країні (без дублів у «Світі»)', async () => {
    await svc.start({ product: { kind: 'toast', tier: 5, text: 'З Новим роком!', countries: ['FR', 'DE'] }, returnPath: '/', clientId: 'rooms' });
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS + TOAST_PAY_MS);
    const paid = seen.at(-1)!;
    expect(paid.toast?.countries).toEqual(['FR', 'DE']);
    const rooms = useChatFeed.getState().rooms;
    for (const room of ['world', 'country:FR', 'country:DE'] as const) {
      expect(rooms[room]?.filter((m) => m.toast?.amount === 5 && m.author?.isMine)).toHaveLength(1);
    }
    expect(useToastStore.getState().said).toHaveLength(1);
    expect(new Set([rooms.world![0]!.id, rooms['country:FR']![0]!.id, rooms['country:DE']![0]!.id]).size).toBe(3);
    expect(rooms['country:IT']).toBeUndefined();
  });

  it('скасування до результату — cancelled, результату немає; перерваний перехід продовжується після перезавантаження', async () => {
    const res = await svc.start({ product: { kind: 'toast', tier: 5, text: 'Ура' }, returnPath: '/', clientId: 'x' });
    await svc.cancel(res.ok ? res.value.order.id : '');
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS + TOAST_PAY_MS);
    expect(seen.at(-1)?.status).toBe('cancelled');
    expect(useToastStore.getState().said).toEqual([]);

    await svc.start({ product: { kind: 'toast', tier: 5, text: 'Ще раз' }, returnPath: '/', clientId: 'y' });
    reloadSimCheckoutForTest();
    expect((await svc.open()).ok && (await svc.open())).toMatchObject({ value: [{ clientId: 'y', status: 'open' }] });
    resumeOpenOrders();
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS);
    expect(seen.at(-1)).toMatchObject({ clientId: 'y', status: 'paid' });
  });
});

describe('стрічка тостів (sim)', () => {
  it('свої тости — у списку й подією «опубліковано»; імітованих поза тестовою збіркою немає', async () => {
    const toasts = createSimToasts();
    expect(await toasts.list()).toEqual({ ok: true, value: [] });
    const events: string[] = [];
    const stop = toasts.subscribe((e) => events.push(e.type));
    await svc.start({ product: { kind: 'toast', tier: 2, text: 'Привіт' }, returnPath: '/', clientId: 'f' });
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS + TOAST_PAY_MS);
    stop();
    expect(events).toEqual(['published']);
    const list = await toasts.list();
    expect(list.ok && list.value.map((t) => t.text)).toEqual(['Привіт']);
    expect(toasts.peek?.()).toBe(toasts.peek?.());
  });
});
