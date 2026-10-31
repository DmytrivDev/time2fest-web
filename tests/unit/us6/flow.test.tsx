import { act, fireEvent, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CookieFooter, CookieInflow, CookieLayer } from '@/components/offers/CookieLayer';
import { useOfferWindows, type PassWindowsApi } from '@/components/offers/useOfferWindows';
import { FacebookConsentCard } from '@/components/player/FacebookConsentCard';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';
import { airSlots } from '@/lib/engine/currentAirEvent';
import { offerEligibility } from '@/lib/engine/offerEligibility';
import { clearAllHandlers, emit } from '@/lib/events/bus';
import { buildOfferContext } from '@/lib/offers/context';
import { resetCookieFlow } from '@/lib/offers/cookieFlow';
import { getOfferUi, installTypingTracking, resetOfferUi } from '@/lib/offers/uiState';
import { useGuestStore } from '@/stores/guest';
import { renderPage } from './render';

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
    expect(buildOfferContext(0)).toBeNull();
    giveStamps(s1, s2);
    const ctx = buildOfferContext(s2.midnightMs + MIN)!;
    expect(ctx.lastEvent?.id).toBe(s2.id);
    expect(ctx.nextEvent?.id).toBe(s3.id);
    expect(ctx.rate).toBe('none');
    expect(ctx.hasPass).toBe(false);
  });

  it('правила часу: не раніше +5 хв, не пізніше −10 хв до наступної, після оцінки', () => {
    giveStamps(s1, s2);
    const at = (t: number) => offerEligibility(t, buildOfferContext(t)!);
    expect(at(s2.midnightMs + 4 * MIN).blockedBy).toContain('too-early');
    expect(at(s2.midnightMs + 6 * MIN).show).toBe('pass-offer');
    expect(at(s3.midnightMs - 9 * MIN).blockedBy).toContain('too-late');

    // Оцінка ще відкрита (до її кінця) → блок; після `rateCloseAt` вважається закритою навіть без запису.
    useGuestStore.getState().setRate(s2.id, { stars: 4 });
    expect(at(s2.midnightMs + 4 * MIN + 30_000).blockedBy).toContain('rate-open');
    useGuestStore.getState().setRate(s2.id, { closed: true });
    expect(at(s2.midnightMs + 6 * MIN).show).toBe('pass-offer');
  });

  it('є пас — пропозицій немає', () => {
    giveStamps(s1, s2);
    useGuestStore.getState().setHasPass(true);
    const t = s2.midnightMs + 6 * MIN;
    expect(offerEligibility(t, buildOfferContext(t)!).blockedBy).toContain('pass');
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
    expect(offerEligibility(t, buildOfferContext(t)!).blockedBy).toContain('typing');
    input.blur();
    expect(getOfferUi().composerFocused).toBe(false);
    expect(offerEligibility(t, buildOfferContext(t)!).show).toBe('pass-offer');
    fireEvent.keyDown(input, { key: 'a' });
    clock.t = t + 3_000;
    const d = offerEligibility(clock.t, buildOfferContext(clock.t)!);
    expect(d.blockedBy).toContain('typing');
    expect(offerEligibility(t + 11_000, buildOfferContext(t + 11_000)!).show).toBe('pass-offer');
    stop();
    input.remove();
  });
});

function Host({ onApi }: { onApi: (api: PassWindowsApi) => void }) {
  const api = useOfferWindows();
  useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

function offerShow(kind: 'pass-offer' | 'tips', triggerEventId: string, stampCount: number) {
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

describe('вікна пропозицій у потоці', () => {
  it('offer:show → картка «Уже 2 країни…» у слоті, запис у guest.offers, звук нейтральний, фокус не забрано', () => {
    giveStamps(s1, s2);
    useGuestStore.setState({ stamps: [stampOf(s1.id, 'UA'), stampOf(s2.id, 'FR')] });
    const before = document.activeElement;
    renderPage(<Host onApi={() => undefined} />);
    expect(screen.queryByRole('heading', { name: /паспорті/ })).toBeNull();
    offerShow('pass-offer', s2.id, 2);
    const slot = document.querySelector('[data-in-flow-slot="occupied"]') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute('aria-live', 'polite');
    expect(slot).toHaveTextContent('Уже 2 країни у твоєму паспорті');
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    expect(document.activeElement).toBe(before);
    const { offers } = useGuestStore.getState();
    expect(offers.visible).toBe('pass-offer');
    expect(offers.history).toMatchObject([{ kind: 'pass-offer', triggerEventId: s2.id }]);
    expect(document.querySelectorAll('[data-variant="coral"]')).toHaveLength(1);
  });

  it('закрита хрестиком не повертається тієї ночі; звук знову коралевий', () => {
    giveStamps(s1, s2);
    renderPage(<Host onApi={() => undefined} />);
    offerShow('pass-offer', s2.id, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити пропозицію' }));
    expect(document.querySelector('[data-in-flow-slot="occupied"]')).toBeNull();
    expect(screen.getByTestId('sound')).toHaveTextContent('coral');
    const { offers } = useGuestStore.getState();
    expect(offers.visible).toBeNull();
    expect(offers.history[0]?.dismissedAt).toBeDefined();
    // Пізніше тієї ж ночі (після 3-го штампа) пас не повертається — лише чайові.
    giveStamps(s1, s2, s3);
    const t = s3.midnightMs + 6 * MIN;
    expect(offerEligibility(t, buildOfferContext(t)!).show).toBe('tips');
  });

  it('Esc закриває картку', () => {
    giveStamps(s1, s2);
    renderPage(<Host onApi={() => undefined} />);
    offerShow('pass-offer', s2.id, 2);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.querySelector('[data-in-flow-slot="occupied"]')).toBeNull();
    expect(useGuestStore.getState().offers.history[0]?.dismissedAt).toBeDefined();
  });

  it('після 3-го — чайові (одна картка за раз)', () => {
    giveStamps(s1, s2, s3);
    renderPage(<Host onApi={() => undefined} />);
    offerShow('tips', s3.id, 3);
    expect(screen.getByRole('heading', { level: 2, name: 'Чайові' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-offer]')).toHaveLength(1);
    expect(useGuestStore.getState().offers.visible).toBe('tips');
  });

  it('«Детальніше» замінює пропозицію карткою «Що дає Новорічний пас»', () => {
    giveStamps(s1, s2);
    renderPage(<Host onApi={() => undefined} />);
    offerShow('pass-offer', s2.id, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Детальніше' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Що дає Новорічний пас' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-offer]')).toHaveLength(1);
    const { offers } = useGuestStore.getState();
    expect(offers.history[0]).toMatchObject({ kind: 'pass-offer', acted: 'details' });
    expect(offers.history[0]?.dismissedAt).toBeDefined();
    expect(offers.visible).toBe('pass-info');
  });

  it('є пас — offer:show ігнорується', () => {
    giveStamps(s1, s2);
    useGuestStore.getState().setHasPass(true);
    renderPage(<Host onApi={() => undefined} />);
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

    useGuestStore.getState().setHasPass(true);
    act(() => api.requestSchedule(s1.id, true));
    expect(useGuestStore.getState().schedule).toEqual([s1.id]);
    expect(document.querySelector('[data-offer]')).toBeNull();
  });

  it('залишок visible після перезавантаження скидається, щоб не блокувати пропозиції', () => {
    useGuestStore.setState({ offers: { nightId: '2026-27', history: [], visible: 'pass-offer' } });
    renderPage(<Host onApi={() => undefined} />);
    expect(useGuestStore.getState().offers.visible).toBeNull();
  });

  it('рядок «Штамп у паспорті» не вважається відкритим вікном для рушія', () => {
    renderPage(<Host onApi={() => undefined} />);
    expect(getOfferUi().overlayOpen).toBe(false);
  });
});

describe('cookies', () => {
  const consent = () => useGuestStore.getState().consent;

  it('телефон: смуга внизу, нижній відступ сторінки; «Прийняти» вмикає все й ховає банер', () => {
    renderPage(<CookieLayer />);
    const banner = screen.getByRole('region', { name: 'Згода на cookies' });
    expect(banner).toHaveAttribute('data-cookie-banner', 'strip');
    expect(document.body.style.paddingBottom).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Прийняти' }));
    expect(consent()).toMatchObject({ answered: true, necessary: true, analytics: true, marketing: true, facebookVideo: true });
    expect(screen.queryByRole('region', { name: 'Згода на cookies' })).toBeNull();
    expect(document.body.style.paddingBottom).toBe('');
  });

  it('«Лише необхідні» вимикає все, крім необхідних', () => {
    renderPage(<CookieLayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Лише необхідні' }));
    expect(consent()).toMatchObject({ answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false });
  });

  it('десктоп із чатом: куток; чат сховано і є місце в потоці — смуга на місці штампа, кута немає', () => {
    mockColumn(true);
    const { unmount } = renderPage(<CookieLayer />);
    expect(document.querySelector('[data-cookie-banner="corner"]')).not.toBeNull();
    unmount();

    useGuestStore.setState({ chatHidden: true });
    renderPage(
      <>
        <CookieLayer />
        <CookieInflow />
      </>,
    );
    expect(document.querySelectorAll('[data-cookie-banner]')).toHaveLength(1);
    expect(document.querySelector('[data-cookie-banner="inflow"]')).not.toBeNull();
    expect(document.body.style.paddingBottom).toBe('');
  });

  it('чат сховано, але місця в потоці немає (сторінка без плеєра) — банер лишається в куті', () => {
    mockColumn(true);
    useGuestStore.setState({ chatHidden: true });
    renderPage(<CookieLayer />);
    expect(document.querySelector('[data-cookie-banner="corner"]')).not.toBeNull();
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
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    fireEvent.click(screen.getByRole('switch', { name: 'Відео з Facebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти вибір' }));
    expect(consent()).toMatchObject({ answered: true, analytics: false, marketing: false, facebookVideo: true });
    expect(document.querySelector('[data-consent="allowed"]')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Згода на cookies' })).toBeNull();
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
    expect(screen.queryByRole('region', { name: 'Згода на cookies' })).toBeNull();
  });
});
