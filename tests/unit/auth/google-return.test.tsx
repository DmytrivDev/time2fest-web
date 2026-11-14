/**
 * Новий акаунт Google після справжнього переходу (рішення власника 2026-11-14): сторінка повертається з
 * `?signin=google&new=1` (Better Auth `newUserCallbackURL`) і сама відкриває крок «Як тебе показувати»; той, хто вже мав
 * акаунт, повертається без `new=1` і кроку не бачить. У `sim` — перемикач «Google: повним переходом сторінки».
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnNotice } from '@/components/checkout/ReturnNotice';
import { OverlayManager } from '@/components/shell/OverlayManager';
import { LiveAnnouncer } from '@/components/primitives/a11y/LiveAnnouncer';
import { createSimAuth, googleReturnUrl } from '@/lib/api/sim/auth';
import { GOOGLE_DELAY_MS } from '@/lib/auth/sim';
import { takeWelcome } from '@/lib/auth/returnTo';
import messages from '@/messages/uk.json';
import { useAuthStore } from '@/stores/auth';
import { useTestControls } from '@/stores/testControls';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }));

beforeEach(() => {
  useTestControls.setState({ googleCancelled: false, googleRedirect: false });
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('Google повним переходом (sim)', () => {
  it('адреса повернення: `signin=google`, новий акаунт — ще `new=1`; хеш і наявні параметри зберігаються', () => {
    expect(googleReturnUrl('/', true)).toBe('/?signin=google&new=1');
    expect(googleReturnUrl('/country/fr/?event=x', false)).toBe('/country/fr/?event=x&signin=google');
    expect(googleReturnUrl('/pass/#buy', true)).toBe('/pass/?signin=google&new=1#buy');
  });

  it('перемикач: вхід стається «на боці Google», сервіс віддає redirect; повторний вхід — без `new=1`', async () => {
    vi.useFakeTimers();
    useTestControls.setState({ googleRedirect: true });
    const svc = createSimAuth();
    const first = svc.google({ returnPath: '/' });
    vi.advanceTimersByTime(GOOGLE_DELAY_MS);
    expect(await first).toEqual({ ok: true, value: { kind: 'redirect', url: '/?signin=google&new=1' } });
    expect(useAuthStore.getState().user?.via).toBe('google');
    await svc.signOut();
    const again = svc.google({ returnPath: '/' });
    vi.advanceTimersByTime(GOOGLE_DELAY_MS);
    expect(await again).toEqual({ ok: true, value: { kind: 'redirect', url: '/?signin=google' } });
  });
});

function renderNotice(profileStep?: 'window' | 'page') {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages}>
      <LiveAnnouncer>
        <OverlayManager>
          <ReturnNotice {...(profileStep ? { profileStep } : {})} />
        </OverlayManager>
      </LiveAnnouncer>
    </NextIntlClientProvider>,
  );
}

describe('повернення з Google', () => {
  it('новий акаунт (`new=1`): смуга «Ти увійшов» і одразу крок «Як тебе показувати» вікном', async () => {
    useAuthStore.getState().signInGoogle(Date.now());
    window.history.replaceState(null, '', '/?signin=google&new=1');
    renderNotice();
    await waitFor(() => expect(document.querySelector('[data-return-notice="google-ok"]')).not.toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Акаунт створено' })).toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('наявний акаунт (без `new=1`): лише смуга, кроку профілю немає', async () => {
    useAuthStore.getState().signInGoogle(Date.now());
    window.history.replaceState(null, '', '/?signin=google');
    renderNotice();
    await waitFor(() => expect(document.querySelector('[data-return-notice="google-ok"]')).not.toBeNull());
    await act(async () => undefined);
    expect(screen.queryByRole('heading', { name: 'Акаунт створено' })).toBeNull();
  });

  it('сторінка без вікон (`/pass/`): новий акаунт — на `/signup/` з кроком профілю', async () => {
    useAuthStore.getState().signInGoogle(Date.now());
    window.history.replaceState(null, '', '/pass/?signin=google&new=1');
    renderNotice('page');
    await waitFor(() => expect(document.querySelector('[data-return-notice="google-ok"]')).not.toBeNull());
    await waitFor(() => expect(takeWelcome()).toBe(true));
  });
});
