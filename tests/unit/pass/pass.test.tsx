import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassBuy } from '@/components/pass/PassBuy';
import { PassPerksTiles } from '@/components/pass/PassPerks';
import { GOOGLE_DELAY_MS } from '@/lib/auth/sim';
import { PAY_ROUNDTRIP_MS } from '@/lib/firstrow/pay';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { usePassStore } from '@/stores/pass';
import { useTestControls } from '@/stores/testControls';
import { renderWithApp } from '../_support/render';

const T0 = Date.UTC(2026, 11, 28, 18, 0, 0);

function resetAll() {
  useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [], passes: {} });
  useGuestStore.getState().setHasPass(false);
  usePassStore.getState().reset();
  useTestControls.getState().setPayResult('success');
  useTestControls.getState().setGoogleCancelled(false);
}

describe('оформлення пасу (імітація): гість, увійшов, результат оплати', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    resetAll();
  });
  afterEach(() => vi.useRealTimers());

  it('гість з email: помилка адреси — оплату не почато; правильна — акаунт створено з оплатою, пас на акаунті й пристрої', () => {
    const pass = () => usePassStore.getState();
    pass().setEmail('olena@example');
    expect(pass().submitEmail()).toBe(false);
    expect(pass().emailIssue).toBe('invalid');
    pass().setEmail(' Olena@Example.com ');
    expect(pass().emailIssue).toBeNull();
    expect(pass().submitEmail()).toBe(true);
    expect(pass().phase).toBe('opening');
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('success');
    expect(useAuthStore.getState().user?.email).toBe('olena@example.com');
    expect(useAuthStore.getState().passes['olena@example.com']).toBe(T0 + PAY_ROUNDTRIP_MS);
    expect(useGuestStore.getState().hasPass).toBe(true);
  });

  it('адреса, на яку пас уже оформлено: «На цю адресу пас уже оформлено», без оплати', () => {
    useAuthStore.setState({ accounts: ['olena@example.com'], passes: { 'olena@example.com': T0 - 1000 } });
    const pass = () => usePassStore.getState();
    pass().setEmail('olena@example.com');
    expect(pass().submitEmail()).toBe(false);
    expect(pass().paidEmail).toBe(true);
    expect(pass().phase).toBe('form');
    // Вхід у такий акаунт вмикає пас і на цьому пристрої.
    useAuthStore.getState().signInWithPurchase('olena@example.com', T0);
    expect(useGuestStore.getState().hasPass).toBe(true);
  });

  it('той, хто увійшов: оплата без email; «Чекаємо підтвердження» → підтверджено; «Оплата не пройшла» → «Спробувати ще»', () => {
    useAuthStore.getState().signInGoogle(T0);
    const pass = () => usePassStore.getState();
    useTestControls.getState().setPayResult('declined');
    pass().pay();
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('failed');
    expect(useGuestStore.getState().hasPass).toBe(false);

    useTestControls.getState().setPayResult('pending');
    pass().pay();
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('pending');
    expect(pass().pendingSince).toBeDefined();
    pass().confirm();
    expect(pass().phase).toBe('success');
    expect(useGuestStore.getState().hasPass).toBe(true);
  });

  it('«Оформити з Google»: вхід Google, далі оплата; скасовано — рядок помилки й форма', () => {
    const pass = () => usePassStore.getState();
    useTestControls.getState().setGoogleCancelled(true);
    pass().startGoogle();
    expect(pass().phase).toBe('google');
    act(() => vi.advanceTimersByTime(GOOGLE_DELAY_MS));
    expect(pass().phase).toBe('form');
    expect(pass().googleFailed).toBe(true);

    useTestControls.getState().setGoogleCancelled(false);
    pass().startGoogle();
    act(() => vi.advanceTimersByTime(GOOGLE_DELAY_MS));
    expect(useAuthStore.getState().user?.via).toBe('google');
    expect(pass().phase).toBe('opening');
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('success');
  });
});

describe('PassBuy — картка оформлення', () => {
  beforeEach(resetAll);

  const props = { onSignIn: vi.fn(), onLetterSent: vi.fn(), onDone: vi.fn() };

  it('гість: Google, email, «Оформити пас — $4,99», «Вже маєш акаунт? Увійти»', () => {
    renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Оформити за хвилину' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Оформити з Google' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Оформити пас — $4,99' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(props.onSignIn).toHaveBeenCalled();
  });

  it('помилка email: рядок під полем, поле позначене', () => {
    renderWithApp(<PassBuy variant="page" {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'olena@example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас — $4,99' }));
    expect(screen.getByRole('alert')).toHaveTextContent('після «@» бракує домену');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('адреса з пасом: «Надіслати посилання для входу» надсилає лист і веде до кроку «Лист надіслано»', () => {
    useAuthStore.setState({ accounts: ['olena@example.com'], passes: { 'olena@example.com': 1 } });
    renderWithApp(<PassBuy variant="page" {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'olena@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас — $4,99' }));
    const box = screen.getByRole('alert');
    expect(box).toHaveTextContent('На цю адресу пас уже оформлено');
    expect(screen.getByRole('button', { name: 'Оформити пас — $4,99' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(box).getByRole('button', { name: 'Надіслати посилання для входу' }));
    expect(useAuthStore.getState().letter?.email).toBe('olena@example.com');
    expect(props.onLetterSent).toHaveBeenCalled();
  });

  it('увійшов: без поля email — «Оформлюємо на акаунт …», «Не ти?» виходить з акаунта', () => {
    useAuthStore.getState().signInWithPurchase('olena@example.com', 1);
    renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Оформити на свій акаунт' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull();
    expect(document.querySelector('[data-row="account"]')).toHaveTextContent('Оформлюємо на акаунтolena@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Не ти?' }));
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  });

  it('після оплати: сторінка — «Повернутися на головну», вікно — «Дивитися далі» закриває вікно', () => {
    useAuthStore.getState().signInWithPurchase('olena@example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 1);
    usePassStore.setState({ phase: 'success' });
    const { unmount } = renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Пас активний — свято на повну!' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Повернутися на головну' })).toHaveAttribute('href', '/');
    unmount();
    renderWithApp(<PassBuy variant="stream" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Дивитися далі' }));
    expect(props.onDone).toHaveBeenCalled();
  });

  it('пас уже є: «Твій пас уже діє», купувати вдруге не треба', () => {
    useGuestStore.getState().setHasPass(true);
    renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Твій пас уже діє' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Оформити пас/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'На головну' })).toHaveAttribute('href', '/');
  });
});

describe('«Що вмикається одразу після оплати» — плитки', () => {
  it('п’ять плиток з назвою й описом; приклади сховані від читачів екрана', () => {
    renderWithApp(<PassPerksTiles />);
    const tiles = document.querySelectorAll('[data-perk]');
    expect(tiles).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Що вмикається одразу після оплати' })).toBeInTheDocument();
    for (const tile of tiles) expect(tile.querySelector('[aria-hidden="true"] + *, [aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('−50% на «Перший ряд»')).toBeInTheDocument();
  });
});
