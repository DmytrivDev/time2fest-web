import { act, fireEvent, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieFooter, CookieLayer } from '@/components/offers/CookieLayer';
import { OfferBlock } from '@/components/offers/OfferBlock';
import { useOfferWindows, type PassWindowsApi } from '@/components/offers/useOfferWindows';
import { FacebookConsentCard } from '@/components/player/FacebookConsentCard';
import { getData } from '@/lib/data/load';
import type { OfferEntry, Stamp } from '@/lib/data/types';
import { airSlots } from '@/lib/engine/currentAirEvent';
import { offerEligibility } from '@/lib/engine/offerEligibility';
import { clearAllHandlers, emit } from '@/lib/events/bus';
import { buildOfferContext } from '@/lib/offers/context';
import { resetCookieFlow } from '@/lib/offers/cookieFlow';
import { getOfferUi, installTypingTracking, resetOfferUi } from '@/lib/offers/uiState';
import { useChatFeed } from '@/lib/chat-sim/store';
import { sanitizeGuest, useGuestStore } from '@/stores/guest';
import { renderPage } from './render';
import { grantTestPass } from '@/tests/unit/_support/pass';

const MIN = 60_000;
const slots = airSlots(getData());
const s1 = slots[0]!.events[0]!;
const s2 = slots[1]!.events[0]!;
const s3 = slots[2]!.events[0]!;

function stampOf(eventId: string, countryIso: string): Stamp {
  return { eventId, grantedAt: 0, presenceSource: 'air', illustrationId: 'x', cityName: eventId, countryIso };
}

function giveStamps(...events: { id: string; countryIso: string }[]) {
  useGuestStore.setState({ stamps: events.map((e) => stampOf(e.id, e.countryIso)) });
}

function mockColumn(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  useGuestStore.getState().resetGuest();
  resetOfferUi();
  resetCookieFlow();
  mockColumn(false);
});
afterEach(() => {
  clearAllHandlers();
  document.body.removeAttribute('style');
});

describe('контекст рушія пропозицій', () => {
  it('без штампів — контексту немає; з двома — останній штамп, наступна північ, оцінки ще не було', () => {
    expect(buildOfferContext()).toBeNull();
    giveStamps(s1, s2);
    const ctx = buildOfferContext()!;
    expect(ctx.lastEvent?.id).toBe(s2.id);
    expect(ctx.nextEvent?.id).toBe(s3.id);
    expect(ctx.rate).toBe('none');
    expect(ctx.hasPass).toBe(false);
  });

  it('правила часу: не раніше +5 хв, не пізніше −10 хв до наступної, після оцінки', () => {
    giveStamps(s1, s2);
    const at = (t: number) => offerEligibility(t, buildOfferContext()!);
    expect(at(s2.midnightMs + 4 * MIN).blockedBy).toContain('too-early');
    expect(at(s2.midnightMs + 6 * MIN).show).toBe('pass-offer');
    expect(at(s3.midnightMs - 9 * MIN).blockedBy).toContain('too-late');

    // Оцінка — рядок у штампі (рішення 2026-11-01): вікна не займає, пропозицію не блокує — і зі штампом, і без.
    useGuestStore.getState().setRate(s2.id, { stars: 4 });
    expect(at(s2.midnightMs + 6 * MIN).show).toBe('pass-offer');
    useGuestStore.getState().dismissStamps([s2.id]);
    expect(at(s2.midnightMs + 6 * MIN).show).toBe('pass-offer');
  });

  it('є пас — пропозицій немає', () => {
    giveStamps(s1, s2);
    grantTestPass();
    const t = s2.midnightMs + 6 * MIN;
    expect(offerEligibility(t, buildOfferContext()!).blockedBy).toContain('pass');
  });

  it('введення: фокус у полі та ~10 с після натискання блокують пропозицію', () => {
    giveStamps(s1, s2);
    const t = s2.midnightMs + 6 * MIN;
    const clock = { t };
    const stop = installTypingTracking(() => clock.t);
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    expect(getOfferUi().composerFocused).toBe(true);
    expect(offerEligibility(t, buildOfferContext()!).blockedBy).toContain('typing');
    input.blur();
    expect(getOfferUi().composerFocused).toBe(false);
    expect(offerEligibility(t, buildOfferContext()!).show).toBe('pass-offer');
    fireEvent.keyDown(input, { key: 'a' });
    clock.t = t + 3_000;
    const d = offerEligibility(clock.t, buildOfferContext()!);
    expect(d.blockedBy).toContain('typing');
    expect(offerEligibility(t + 11_000, buildOfferContext()!).show).toBe('pass-offer');
    stop();
    input.remove();
  });
});

const push = vi.fn();
const ROUTER = { push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() };

function Host({ onApi }: { onApi: (api: PassWindowsApi) => void }) {
  const api = useOfferWindows();
  useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

/** Сторінка: хук вікон + блок пропозиції під штампом (рішення 2026-11-01). */
function Page({ onApi = () => undefined }: { onApi?: (api: PassWindowsApi) => void }) {
  return (
    <AppRouterContext.Provider value={ROUTER as never}>
      <Host onApi={onApi} />
      <OfferBlock />
    </AppRouterContext.Provider>
  );
}

function offerShow(kind: 'pass-offer', triggerEventId: string, stampCount: number) {
  act(() => {
    emit('offer:show', {
      eventKey: `offer:${kind}:${triggerEventId}`,
      at: Date.parse('2027-01-01T00:06:00Z'),
      kind,
      triggerEventId,
      stampCount,
      neutralizeSound: true,
    });
  });
}

describe('пропозиції — блок під штампом (рішення 2026-11-01)', () => {
  const block = () => document.querySelector('[data-offer-block]') as HTMLElement | null;

  it('offer:show → картка «2 Нових роки вже твої…» у блоці з aria-live, запис у guest.offers, звук нейтральний, фокус не забрано', () => {
    giveStamps(s1, s2);
    useGuestStore.setState({ stamps: [stampOf(s1.id, 'UA'), stampOf(s2.id, 'FR')] });
    const before = document.activeElement;
    renderPage(<Page />);
    expect(block()).toBeNull();
    offerShow('pass-offer', s2.id, 2);
    expect(block()).toHaveTextContent('2 Нових роки вже твої — далі буде ще краще');
    expect(block()!.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    expect(document.activeElement).toBe(before);
    const { offers } = useGuestStore.getState();
    expect(offers.visible).toBe('pass-offer');
    expect(offers.history).toMatchObject([{ kind: 'pass-offer', triggerEventId: s2.id }]);
    expect(document.querySelectorAll('[data-variant="coral"]')).toHaveLength(1);
    // Прапори країн — круглі.
    expect(block()!.querySelector('[data-round="true"]')).not.toBeNull();
  });

  it('закрита хрестиком не повертається тієї ночі; звук знову коралевий', () => {
    giveStamps(s1, s2);
    renderPage(<Page />);
    offerShow('pass-offer', s2.id, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити пропозицію' }));
    expect(screen.getByTestId('sound')).toHaveTextContent('coral');
    const { offers } = useGuestStore.getState();
    expect(offers.visible).toBeNull();
    expect(offers.history[0]?.dismissedAt).toBeDefined();
    giveStamps(s1, s2, s3);
    const t = s3.midnightMs + 6 * MIN;
    // Чайових після 3-го штампа більше немає (рішення 2026-11-12) — закрита пропозиція пасу не змінюється нічим.
    expect(offerEligibility(t, buildOfferContext()!).show).toBeNull();
  });

  it('вікно збоку (вхід, «Обрати трансляцію»…) пропозицію не прибирає', () => {
    giveStamps(s1, s2);
    let api!: PassWindowsApi;
    renderPage(<Page onApi={(a) => (api = a)} />);
    offerShow('pass-offer', s2.id, 2);
    act(() => api.openScheduleGate());
    expect(block()).toHaveTextContent('2 Нових роки вже твої — далі буде ще краще');
    expect(useGuestStore.getState().offers.history[0]?.dismissedAt).toBeUndefined();
  });

  it('після 3-го штампа картки «Чайові» під штампом немає (2026-11-12): тост — у смузі й кнопках, доступний завжди', () => {
    giveStamps(s1, s2, s3);
    renderPage(<Page />);
    offerShow('pass-offer', s3.id, 3);
    expect(document.querySelectorAll('[data-offer]')).toHaveLength(1);
    expect(block()).toHaveAttribute('data-offer-block', 'pass-offer');
    expect(screen.queryByText('Скажи тост на весь світ')).toBeNull();
    // Пас уже показували — другої пропозиції після 3-го штампа немає.
    expect(offerEligibility(s3.midnightMs + 6 * MIN, buildOfferContext()!).show).toBeNull();
  });

  it('старий запис «чайові» у сховищі гостя (до 2026-11-12) відкидається й нічого не показує', () => {
    giveStamps(s1, s2);
    const legacy = { kind: 'tips', triggerEventId: s2.id, shownAt: 0 } as unknown as OfferEntry;
    const clean = sanitizeGuest({ ...useGuestStore.getState(), offers: { nightId: '2026-27', history: [legacy], visible: 'tips' } })!;
    expect(clean.offers.history).toEqual([]);
    expect(clean.offers.visible).toBeNull();
    useGuestStore.setState({ offers: clean.offers });
    renderPage(<Page />);
    expect(block()).toBeNull();
    expect(useChatFeed.getState().rooms.world ?? []).toHaveLength(0);
    expect(offerEligibility(s2.midnightMs + 6 * MIN, buildOfferContext()!).show).toBe('pass-offer');
  });

  it('«Оформити пас» — вікно пасу на місці чату навіть без трансляції; картка лишається', () => {
    giveStamps(s1, s2);
    renderPage(<Page />);
    offerShow('pass-offer', s2.id, 2);
    fireEvent.click(within(block()!).getByRole('button', { name: 'Оформити пас · $5' }));
    expect(screen.getByRole('dialog', { name: /Новорічний пас/ })).toBeInTheDocument();
    expect(useGuestStore.getState().offers.history[0]).toMatchObject({ kind: 'pass-offer', acted: 'primary' });
    expect(block()).not.toBeNull();
  });

  it('«Детальніше» без трансляції — сторінка /pass/; «Що дає пас» на сторінці більше немає', () => {
    giveStamps(s1, s2);
    renderPage(<Page />);
    offerShow('pass-offer', s2.id, 2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Детальніше' })[0]!);
    expect(push).toHaveBeenCalledWith('/pass/');
    expect(screen.queryByRole('heading', { level: 2, name: 'Що дає Новорічний пас' })).toBeNull();
    expect(useGuestStore.getState().offers.history[0]).toMatchObject({ kind: 'pass-offer', acted: 'details' });
  });

  it('є пас — offer:show ігнорується', () => {
    giveStamps(s1, s2);
    grantTestPass();
    renderPage(<Page />);
    offerShow('pass-offer', s2.id, 2);
    expect(document.querySelector('[data-offer]')).toBeNull();
  });

  it('кнопка графіка без пасу → вікно «Графік — у Новорічному пасі» на місці чату; «Усе про пас»; з пасом — перемикає графік', () => {
    let api!: PassWindowsApi;
    renderPage(<Host onApi={(a) => {
          api = a;
        }} />);
    act(() => api.requestSchedule(s1.id, true));
    expect(screen.getByRole('heading', { name: 'Графік — у Новорічному пасі' })).toBeInTheDocument();
    expect(document.querySelector('[data-window="O-SCHEDULE-GATE"]')).not.toBeNull();
    // Безплатного нагадування у вікні немає (правка власника 2026-10-31).
    expect(screen.queryByText(/безплатно/)).toBeNull();
    expect(useGuestStore.getState().schedule).toEqual([]);
    expect(useGuestStore.getState().offers.visible).toBe('pass-gate');
    fireEvent.click(screen.getByRole('button', { name: /Усе про пас/ }));
    expect(screen.getByRole('heading', { name: 'Що дає Новорічний пас' })).toBeInTheDocument();
    expect(document.querySelector('[data-offer]')).toBeNull();

    grantTestPass();
    act(() => api.requestSchedule(s1.id, true));
    expect(useGuestStore.getState().schedule).toEqual([s1.id]);
    expect(document.querySelector('[data-offer]')).toBeNull();
  });

  it('після перезавантаження пропозиція лишається (доки не закриють або не оформлять пас); з пасом — ні', () => {
    giveStamps(s1, s2);
    useGuestStore.setState({ offers: { nightId: '2026-27', history: [{ kind: 'pass-offer', shownAt: 1, triggerEventId: s2.id }], visible: 'pass-offer' } });
    const { unmount } = renderPage(<Page />);
    expect(block()).toHaveTextContent('2 Нових роки вже твої — далі буде ще краще');
    unmount();
    grantTestPass();
    renderPage(<Page />);
    expect(block()).toBeNull();
  });

  it('рядок «Штамп у паспорті» не вважається відкритим вікном для рушія', () => {
    renderPage(<Page />);
    expect(getOfferUi().overlayOpen).toBe(false);
  });
});

describe('cookies', () => {
  const consent = () => useGuestStore.getState().consent;

  it('телефон: картка внизу, нижній відступ сторінки; «Прийняти» вмикає все й ховає плашку', () => {
    renderPage(<CookieLayer />);
    const banner = screen.getByRole('region', { name: 'Cookies на Time2Fest' });
    expect(banner).toHaveAttribute('data-cookie-banner', 'card');
    expect(document.body.style.paddingBottom).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Прийняти' }));
    expect(consent()).toMatchObject({ answered: true, necessary: true, analytics: true, marketing: true, facebookVideo: true });
    expect(screen.queryByRole('region', { name: 'Cookies на Time2Fest' })).toBeNull();
    expect(document.body.style.paddingBottom).toBe('');
  });

  it('«Лише необхідні» вимикає все, крім необхідних', () => {
    renderPage(<CookieLayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Лише необхідні' }));
    expect(consent()).toMatchObject({ answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false });
  });

  it('× — те саме, що «Лише необхідні»: вибір збережено, плашки більше немає', () => {
    renderPage(<CookieLayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити — лише необхідні' }));
    expect(consent()).toMatchObject({ answered: true, analytics: false, marketing: false, facebookVideo: false });
    expect(screen.queryByRole('region', { name: 'Cookies на Time2Fest' })).toBeNull();
  });

  it('десктоп і телефон горизонтально — один рядок (bar)', () => {
    mockColumn(true);
    renderPage(<CookieLayer />);
    expect(document.querySelector('[data-cookie-banner="bar"]')).not.toBeNull();
  });

  it('«Налаштувати» → 4 категорії; Facebook-згода з налаштувань повертає плеєр (FacebookConsentCard)', () => {
    renderPage(
      <>
        <CookieLayer />
        <FacebookConsentCard />
      </>,
    );
    expect(document.querySelector('[data-consent="needed"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Налаштувати' }));
    expect(screen.getByRole('dialog', { name: 'Налаштування cookies' })).toBeInTheDocument();
    // Плашка зникає, поки відкриті налаштування.
    expect(screen.queryByRole('region', { name: 'Cookies на Time2Fest' })).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    fireEvent.click(screen.getByRole('switch', { name: 'Відео з Facebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти вибір' }));
    expect(consent()).toMatchObject({ answered: true, analytics: false, marketing: false, facebookVideo: true });
    expect(document.querySelector('[data-consent="allowed"]')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Cookies на Time2Fest' })).toBeNull();
  });

  it('футер: «Налаштування cookies» відкриває налаштування і після відповіді', () => {
    useGuestStore.getState().setConsent({ analytics: true });
    renderPage(<CookieFooter />);
    fireEvent.click(screen.getByRole('button', { name: 'Налаштування cookies' }));
    expect(screen.getByRole('dialog', { name: 'Налаштування cookies' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Аналітика' })).toBeChecked();
  });

  it('вибір не збережено (сховище недоступне): тихий рядок і «Спробувати ще»', () => {
    renderPage(<CookieLayer />);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Прийняти' }));
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося зберегти вибір');
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Cookies на Time2Fest' })).toBeNull();
  });
});
