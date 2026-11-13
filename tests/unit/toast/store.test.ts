/**
 * Оплата тосту й пас у подарунок (рішення власника 2026-11-12; пас належить акаунту — 2026-11-10):
 * фільтр і підпис до оплати, свої тости переживають перезавантаження, незавершена оплата доходить до результату,
 * подарунковий пас гостя переходить на акаунт при першому вході чи створенні акаунта.
 */
import { simEmailSignIn } from '@/lib/api/sim/auth';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatFeed } from '@/lib/chat-sim/store';
import { PAY_ROUNDTRIP_MS } from '@/lib/offers/paySim';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { resetDeviceState } from '@/stores/resetDevice';
import { useTestControls } from '@/stores/testControls';
import { resumeToastFlow, setToastClock, TOAST_PAY_MS, TOAST_STORAGE_KEY, useToastStore } from '@/stores/toast';

const T0 = Date.UTC(2026, 11, 31, 22, 30, 0);
const hasPass = () => useGuestStore.getState().hasPass;
const settle = () => act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS + TOAST_PAY_MS + 10));

function payToast(tier: 2 | 5 | 10, text = 'З Новим роком!') {
  const s = useToastStore.getState();
  s.prepare(tier, text);
  s.setText(text);
  return useToastStore.getState().pay();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  setToastClock(() => Date.now());
  window.localStorage.clear();
  useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [], passes: {}, pendingPassGift: null });
  useGuestStore.getState().resetGuest();
  useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
  useChatFeed.getState().reset();
  useToastStore.getState().reset();
  useToastStore.setState({ said: [] });
  useTestControls.getState().setPayResult('success');
});
afterEach(() => {
  useTestControls.getState().setPayResult('success');
  vi.useRealTimers();
});

describe('фільтр і підпис — до оплати', () => {
  it('текст із посиланням: оплату не починаємо, місце проблеми — у стані; змінили текст — проблему знято', () => {
    expect(payToast(5, 'Пишіть: t.me/olena_ny')).toBe(false);
    expect(useToastStore.getState()).toMatchObject({ phase: 'form', issue: { kind: 'link' } });
    useToastStore.getState().setText('Пишіть у чаті');
    expect(useToastStore.getState().issue).toBeNull();
    expect(useToastStore.getState().pay()).toBe(true);
    expect(useToastStore.getState().phase).toBe('paying');
  });

  it('гість без дійсного ніку: оплату не починаємо (тост не підписують «Гість»)', () => {
    useGuestStore.setState({ nick: undefined });
    expect(payToast(5)).toBe(false);
    expect(useToastStore.getState().phase).toBe('form');
    useGuestStore.setState({ nick: 'О' });
    expect(payToast(5)).toBe(false);
    useGuestStore.setState({ nick: 'Олена' });
    expect(payToast(5)).toBe(true);
  });

  it('порожній текст — не оплачуємо', () => {
    useToastStore.getState().prepare(5, '');
    expect(useToastStore.getState().pay()).toBe(false);
  });
});

describe('оплата й свої тости', () => {
  it('підтверджено — тост у чаті «Світ» і серед своїх; після «перезавантаження» свої тости лишаються', async () => {
    payToast(5, 'За всіх!');
    settle();
    expect(useToastStore.getState().phase).toBe('success');
    expect(useToastStore.getState().last).toMatchObject({ tier: 5, text: 'За всіх!', nick: 'Олена', mine: true, createdAt: T0 + PAY_ROUNDTRIP_MS + TOAST_PAY_MS });
    expect((useChatFeed.getState().rooms.world ?? []).at(-1)).toMatchObject({ toast: { amount: 5 }, text: 'За всіх!' });
    const saved = JSON.parse(window.localStorage.getItem(TOAST_STORAGE_KEY) ?? '{}');
    expect(saved.state.said).toHaveLength(1);
    expect(saved.state.flow).toBeNull();
    // «Перезавантаження»: у пам’яті порожньо, у сховищі — те, що було.
    const raw = window.localStorage.getItem(TOAST_STORAGE_KEY)!;
    useToastStore.setState({ said: [] });
    window.localStorage.setItem(TOAST_STORAGE_KEY, raw);
    await resumeToastFlow();
    expect(useToastStore.getState().said.map((t) => t.text)).toEqual(['За всіх!']);
  });

  it('«чекаємо підтвердження» переживає перезавантаження й підтверджується', async () => {
    useTestControls.getState().setPayResult('pending');
    payToast(10, 'Феєрверк!');
    settle();
    expect(useToastStore.getState().pendingSince).toBeTypeOf('number');
    const raw = window.localStorage.getItem(TOAST_STORAGE_KEY);
    useToastStore.getState().reset();
    window.localStorage.setItem(TOAST_STORAGE_KEY, raw!);
    await resumeToastFlow();
    expect(useToastStore.getState()).toMatchObject({ phase: 'paying', tier: 10, text: 'Феєрверк!' });
    useToastStore.getState().confirm();
    expect(useToastStore.getState().phase).toBe('success');
  });

  it('оплата не пройшла — тост лишається для «Спробувати ще»; закрили вікно — форма з тим самим текстом і $5', () => {
    useTestControls.getState().setPayResult('declined');
    payToast(10, 'Ще раз!');
    settle();
    expect(useToastStore.getState()).toMatchObject({ phase: 'failed', text: 'Ще раз!' });
    useToastStore.getState().closed();
    expect(useToastStore.getState()).toMatchObject({ phase: 'form', text: 'Ще раз!', tier: 5 });
  });
});

describe('пас у подарунок до тосту за $10', () => {
  it('той, хто увійшов, — пас одразу на акаунті', () => {
    useAuthStore.getState().signInWithPurchase('olena@example.com', T0);
    payToast(10);
    settle();
    expect(useToastStore.getState().gift).toBe('active');
    expect(useAuthStore.getState().passes['olena@example.com']).toBeDefined();
    expect(hasPass()).toBe(true);
    expect(useToastStore.getState().last?.pass).toBe(true);
  });

  it('гість — пас чекає на пристрої; перший вхід (Google) переносить його на акаунт і прибирає з пристрою', () => {
    payToast(10);
    settle();
    expect(useToastStore.getState().gift).toBe('pending');
    expect(useAuthStore.getState().pendingPassGift).toBe(T0 + PAY_ROUNDTRIP_MS + TOAST_PAY_MS);
    expect(hasPass()).toBe(false);
    const { email } = useAuthStore.getState().signInGoogle(T0 + 60_000);
    expect(useAuthStore.getState().passes[email]).toBe(T0 + PAY_ROUNDTRIP_MS + TOAST_PAY_MS);
    expect(useAuthStore.getState().pendingPassGift).toBeNull();
    expect(hasPass()).toBe(true);
    // Вихід знімає пас з пристрою, а подарунок уже належить акаунту — інший вхід його не отримає.
    useAuthStore.getState().signOut();
    simEmailSignIn('other@example.com', 'signup', T0 + 120_000);
    expect(hasPass()).toBe(false);
  });

  it('гість створює акаунт поштою — пас на новому акаунті', () => {
    payToast(10);
    settle();
    const res = simEmailSignIn('new@example.com', 'signup', T0 + 60_000);
    expect(res).toMatchObject({ ok: true, sent: false });
    expect(useAuthStore.getState().passes['new@example.com']).toBeDefined();
    expect(hasPass()).toBe(true);
  });

  it('власник пасу: подарунка немає; $5 — подарунка немає', () => {
    payToast(5);
    settle();
    expect(useToastStore.getState().gift).toBeNull();
    expect(useAuthStore.getState().pendingPassGift).toBeNull();
    useAuthStore.getState().signInWithPurchase('olena@example.com', T0);
    useAuthStore.getState().grantPass('olena@example.com', T0);
    payToast(10);
    settle();
    expect(useToastStore.getState().gift).toBeNull();
  });

  it('«Скинути стан гостя» стирає й свої тости, й подарунок, що чекав', () => {
    payToast(10);
    settle();
    resetDeviceState();
    expect(useToastStore.getState().said).toEqual([]);
    expect(useAuthStore.getState().pendingPassGift).toBeNull();
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith('t2f:'))).toEqual([]);
  });
});
