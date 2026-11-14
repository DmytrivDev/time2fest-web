import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassBuy } from '@/components/pass/PassBuy';
import { PassPerksShowcase } from '@/components/pass/PassPerks';
import { GOOGLE_DELAY_MS } from '@/lib/auth/sim';
import { PAY_ROUNDTRIP_MS } from '@/lib/offers/paySim';
import { fail } from '@/lib/api/result';
import { getService, setServicesForTest } from '@/lib/api/services';
import { useAuthStore } from '@/stores/auth';
import { usePassStore } from '@/stores/pass';
import { useTestControls } from '@/stores/testControls';
import { renderWithApp } from '../_support/render';
import { grantTestPass, testHasPass } from '@/tests/unit/_support/pass';

const T0 = Date.UTC(2026, 11, 28, 18, 0, 0);

function resetAll() {
  useAuthStore.setState({ user: null, accounts: [], code: null, devicePass: null, sends: [], passes: {} });
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

  it('гість з email: помилка адреси — оплату не почато; правильна — пас на пристрої одразу, без входу (рішення 2026-11-13)', async () => {
    const pass = () => usePassStore.getState();
    pass().setEmail('olena@example');
    expect(pass().submitEmail()).toBe(false);
    expect(pass().emailIssue).toBe('invalid');
    pass().setEmail(' Olena@Example.com ');
    expect(pass().emailIssue).toBeNull();
    expect(pass().submitEmail()).toBe(true);
    // «Переходимо на оплату» — щойно сервіс оплати прийняв замовлення (шов, залишки E5; у `sim` — той самий такт).
    await act(async () => undefined);
    expect(pass().phase).toBe('opening');
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('success');
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().passes['olena@example.com']).toBe(T0 + PAY_ROUNDTRIP_MS);
    expect(testHasPass()).toBe(true);
  });

  it('адреса, на яку пас уже оформлено: «На цю адресу пас уже оформлено», без оплати', async () => {
    useAuthStore.setState({ accounts: ['olena@example.com'], passes: { 'olena@example.com': T0 - 1000 } });
    const pass = () => usePassStore.getState();
    pass().setEmail('olena@example.com');
    // Перевіряє сервіс оплати (`conflict` `pass-owned`), а не вікно саме.
    pass().submitEmail();
    await act(async () => undefined);
    expect(pass().paidEmail).toBe(true);
    expect(pass().phase).toBe('form');
    expect(pass().clientId).toBeUndefined();
    // Вхід у такий акаунт вмикає пас і на цьому пристрої.
    useAuthStore.getState().signInVerified('olena@example.com', T0);
    expect(testHasPass()).toBe(true);
  });

  it('той, хто увійшов: оплата без email; «Чекаємо підтвердження» → підтверджено; «Оплата не пройшла» → «Спробувати ще»', () => {
    useAuthStore.getState().signInGoogle(T0);
    const pass = () => usePassStore.getState();
    useTestControls.getState().setPayResult('declined');
    pass().pay();
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('failed');
    expect(testHasPass()).toBe(false);

    useTestControls.getState().setPayResult('pending');
    pass().pay();
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('pending');
    expect(pass().pendingSince).toBeDefined();
    pass().confirm();
    expect(pass().phase).toBe('success');
    expect(testHasPass()).toBe(true);
  });

  it('«Оформити з Google»: вхід Google, далі оплата; скасовано — рядок помилки й форма', async () => {
    const pass = () => usePassStore.getState();
    useTestControls.getState().setGoogleCancelled(true);
    pass().startGoogle();
    expect(pass().phase).toBe('google');
    // Вхід Google — через сервіс входу (асинхронно, шов — залишки E5).
    await act(async () => vi.advanceTimersByTime(GOOGLE_DELAY_MS));
    expect(pass().phase).toBe('form');
    expect(pass().googleFailed).toBe(true);

    useTestControls.getState().setGoogleCancelled(false);
    pass().startGoogle();
    await act(async () => vi.advanceTimersByTime(GOOGLE_DELAY_MS));
    expect(useAuthStore.getState().user?.via).toBe('google');
    expect(pass().phase).toBe('opening');
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(pass().phase).toBe('success');
  });
});

describe('PassBuy — картка оформлення', () => {
  beforeEach(resetAll);

  const props = { onSignIn: vi.fn(), onCodeSent: vi.fn(), onDone: vi.fn() };

  it('гість: Google, email, «Оформити пас — $5», «Вже маєш акаунт? Увійти»', () => {
    renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Оформити за хвилину' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Оформити з Google' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Оформити пас — $5' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(props.onSignIn).toHaveBeenCalled();
  });

  it('дрібний текст під кнопкою: оплата й згода разом; інші шляхи — окремою групою: «Увійти» й тост за $10, без «Першого ряду»', () => {
    const { unmount } = renderWithApp(<PassBuy variant="page" {...props} />);
    const fine = document.querySelector('[data-row="fine-print"]');
    expect(fine).toHaveTextContent('Оплата на сторінці PayPro Global.');
    expect(fine).toHaveTextContent('Акаунт — з 13 років');
    const alt = document.querySelector('[data-row="alternatives"]') as HTMLElement;
    expect(within(alt).getByRole('button', { name: 'Увійти' })).toBeInTheDocument();
    // «Перший ряд» прибрано (рішення 2026-11-12); замість нього — тост за $10 з пасом у подарунок (дошка `Pass-5-New`):
    // на сторінці пасу вікон немає — посилання на «Тости світу» з вікном тосту на $10.
    const links = within(alt).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Скажи тост за $10…і Новорічний пас у подарунок');
    expect(links[0]!.getAttribute('href')).toMatch(/^\/support\/?\?toast=10$/);
    expect(document.body).not.toHaveTextContent('Перш');
    unmount();
    // У вікні — рядок оплати про трансляцію; рядок тосту — у самому вікні пасу (над оформленням), не в картці.
    renderWithApp(<PassBuy variant="stream" {...props} />);
    expect(document.querySelector('[data-row="fine-print"]')).toHaveTextContent('трансляція грає далі.');
    expect(document.querySelector('[data-row="toast-gift"]')).toBeNull();
  });

  it('помилка email: рядок під полем, поле позначене', () => {
    renderWithApp(<PassBuy variant="page" {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'olena@example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас — $5' }));
    expect(screen.getByRole('alert')).toHaveTextContent('після «@» бракує домену');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('гість після оплати: «Пас працює на цьому пристрої» і «Увійти кодом» — код на пошту з оплати', async () => {
    useAuthStore.getState().grantDevicePass('olena@example.com', T0);
    usePassStore.setState({ phase: 'success' });
    renderWithApp(<PassBuy variant="page" {...props} />);
    const row = document.querySelector('[data-row="device-pass"]')!;
    expect(row).toHaveTextContent('Пас працює на цьому пристрої');
    expect(row).toHaveTextContent('olena@example.com');
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Увійти кодом' }));
    await waitFor(() => expect(props.onCodeSent).toHaveBeenCalled());
    expect(useAuthStore.getState().code?.email).toBe('olena@example.com');
  });

  it('старт оплати не вдався (мережа) — «Не вдалося відкрити оплату», «Спробувати ще»; замовлення минуло — «Час на оплату минув»', async () => {
    const restore = setServicesForTest({ checkout: { ...getService('checkout'), start: async () => fail('network') } });
    useAuthStore.getState().signInVerified('olena@example.com', T0);
    renderWithApp(<PassBuy variant="page" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас — $5' }));
    expect(await screen.findByText('Не вдалося відкрити оплату')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Спробувати ще — $5' })).toBeInTheDocument();
    restore();
    act(() => usePassStore.setState({ phase: 'expired' }));
    expect(screen.getByText('Час на оплату минув')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Оформити заново' }));
    expect(usePassStore.getState().phase).toBe('form');
  });

  it('адреса з пасом: «Надіслати код» надсилає код і веде до кроку «Введи код»', async () => {
    useAuthStore.setState({ accounts: ['olena@example.com'], passes: { 'olena@example.com': 1 } });
    renderWithApp(<PassBuy variant="page" {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'olena@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас — $5' }));
    const box = await screen.findByRole('alert');
    expect(box).toHaveTextContent('На цю адресу пас уже оформлено');
    expect(box).toHaveTextContent('Код для входу надішлемо на цю пошту.');
    expect(screen.getByRole('button', { name: 'Оформити пас — $5' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(box).getByRole('button', { name: 'Надіслати код' }));
    // Код — через сервіс входу (асинхронно).
    await waitFor(() => expect(props.onCodeSent).toHaveBeenCalled());
    expect(useAuthStore.getState().code?.email).toBe('olena@example.com');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('увійшов: без поля email — «Оформлюємо на акаунт …», «Не ти?» виходить з акаунта', () => {
    useAuthStore.getState().signInVerified('olena@example.com', 1);
    renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Оформити на свій акаунт' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull();
    expect(document.querySelector('[data-row="account"]')).toHaveTextContent('Оформлюємо на акаунтolena@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Не ти?' }));
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  });

  it('після оплати: сторінка — «Повернутися на головну», вікно — «Дивитися далі» закриває вікно', () => {
    useAuthStore.getState().signInVerified('olena@example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 1);
    usePassStore.setState({ phase: 'success' });
    const { unmount } = renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Пас активний — свято на повну!' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Повернутися на головну' })).toHaveAttribute('href', '/');
    unmount();
    renderWithApp(<PassBuy variant="stream" {...props} />);
    expect(screen.getByRole('link', { name: 'Детальніше про пас' }).getAttribute('href')).toMatch(/^\/pass\/?$/);
    fireEvent.click(screen.getByRole('button', { name: 'Дивитися далі' }));
    expect(props.onDone).toHaveBeenCalled();
  });

  it('пас уже є: «Твій пас уже діє», купувати вдруге не треба', () => {
    grantTestPass();
    renderWithApp(<PassBuy variant="page" {...props} />);
    expect(screen.getByRole('heading', { name: 'Твій пас уже діє' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Оформити пас/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'На головну' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Сезон 2026/27')).toBeInTheDocument();
  });

  it('пас уже є, вікно: «Дивитися далі» і «Детальніше про пас», без «Мій паспорт»', () => {
    grantTestPass();
    renderWithApp(<PassBuy variant="stream" {...props} />);
    expect(screen.getByRole('button', { name: 'Дивитися далі' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Детальніше про пас' }).getAttribute('href')).toMatch(/^\/pass\/?$/);
    expect(screen.queryByRole('link', { name: 'Мій паспорт Нових років' })).toBeNull();
  });
});

describe('«Що вмикається одразу після оплати» — вітрина з порівнянням', () => {
  it('п’ять можливостей «без → з»; відкрита одна — з порівнянням, описом і прикладом (схованим від читачів екрана)', () => {
    renderWithApp(<PassPerksShowcase />);
    // Знижку −50% на «Перший ряд» прибрано разом із рядом (рішення 2026-11-12).
    expect(document.querySelectorAll('[data-perk]')).toHaveLength(5);
    expect(document.querySelector('[data-perk="seat"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Що вмикається одразу після оплати' })).toBeInTheDocument();
    expect(screen.getByText('Усі трансляції й чат — безплатно для всіх. Пас додає ось що:')).toBeInTheDocument();
    const chat = screen.getByRole('button', { name: /Позначка в чаті й видимий шлях/ });
    expect(chat).toHaveAttribute('aria-expanded', 'true');
    const side = document.querySelector('[data-panel="chat"]');
    expect(side).toHaveTextContent('Без пасуЗвичайне ім’я');
    expect(side?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('клік по іншій можливості відкриває її, попередня закривається', () => {
    renderWithApp(<PassPerksShowcase />);
    const schedule = screen.getByRole('button', { name: /Свій графік і нагадування/ });
    fireEvent.click(schedule);
    expect(schedule).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Позначка в чаті/ })).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-panel="schedule"]')).toHaveTextContent('Свої події й нагадування');
  });
  it('останній пункт «Переклад і сповіщення в чаті»: порівняння й два приклади в ряд', () => {
    renderWithApp(<PassPerksShowcase />);
    expect(screen.getByText('У пасі — 5 можливостей')).toBeInTheDocument();
    const item = screen.getByRole('button', { name: /Переклад і сповіщення в чаті/ });
    fireEvent.click(item);
    expect(item).toHaveAttribute('aria-expanded', 'true');
    const panel = document.querySelector('[data-panel="chatx"]')!;
    expect(panel).toHaveTextContent('Мовою автора, без сповіщень');
    expect(panel).toHaveTextContent('Тобі відповіли');
    expect(panel).toHaveTextContent('Обійми з Бразилії!');
  });
});
