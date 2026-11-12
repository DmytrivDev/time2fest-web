import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stamp } from '@/lib/data/types';
import { createDefaultGuest, dropLegacyKeys, GUEST_STORAGE_KEY, sanitizeGuest, useGuestStore } from '@/stores/guest';
import { SOUND_KEY } from '@/stores/session';

const stamp = (eventId: string): Stamp => ({
  eventId,
  grantedAt: 1,
  presenceSource: 'air',
  illustrationId: 'x',
  cityName: 'Лондон',
  countryIso: 'GB',
});

const saved = () => JSON.parse(localStorage.getItem(GUEST_STORAGE_KEY) ?? 'null') as { state: Record<string, unknown>; version: number } | null;

beforeEach(() => {
  useGuestStore.getState().resetGuest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guest store', () => {
  it('стан за замовчуванням за data-model розділ 2', () => {
    const g = createDefaultGuest();
    expect(g).toMatchObject({
      v: 1,
      locale: 'uk',
      consent: { answered: false, necessary: true, analytics: false, marketing: false, facebookVideo: false },
      reducedMotion: false,
      chatHidden: false,
      zoneStreamsCollapsed: false,
      chat: { lastRoom: 'world', sentAt: [] },
      room: { windows: [], soundSlot: null },
      stamps: [],
      offers: { nightId: '2026-27', history: [], visible: null },
      hasPass: false,
      nightId: '2026-27',
    });
    expect(g.id).toMatch(/.{8,}/);
  });

  it('зберігає в localStorage під ключем t2f:guest:v1 (лише дані, без функцій)', () => {
    useGuestStore.getState().setNick('Оля', 'UA');
    const s = saved()!;
    expect(s.version).toBe(1);
    expect(s.state.nick).toBe('Оля');
    expect(s.state.flagCode).toBe('UA');
    expect(s.state.setNick).toBeUndefined();
  });

  it('штамп один на подію', () => {
    const st = useGuestStore.getState();
    expect(st.addStamp(stamp('evt_london_2027'))).toBe(true);
    expect(useGuestStore.getState().addStamp(stamp('evt_london_2027'))).toBe(false);
    expect(useGuestStore.getState().stamps).toHaveLength(1);
  });

  it('згоди, «зменшити рух», чат, мапа, кімната', () => {
    const st = useGuestStore.getState();
    st.setConsent({ facebookVideo: true });
    st.setReducedMotion(true);
    st.setChatHidden(true);
    st.setZoneStreamsCollapsed(true);
    st.setRoomWindows([{ slot: 0, sourceId: 's', eventId: 'e' }]);
    st.setSoundSlot(0);
    const g = useGuestStore.getState();
    expect(g.consent).toMatchObject({ answered: true, necessary: true, facebookVideo: true });
    expect(g.reducedMotion && g.chatHidden && g.zoneStreamsCollapsed).toBe(true);
    expect(g.room).toEqual({ windows: [{ slot: 0, sourceId: 's', eventId: 'e' }], soundSlot: 0 });
  });

  it('пропозиції: показ, закриття хрестиком, дія', () => {
    const st = useGuestStore.getState();
    st.showOffer('pass-offer', 'evt_london_2027', 100);
    expect(useGuestStore.getState().offers.visible).toBe('pass-offer');
    useGuestStore.getState().actOffer('details');
    useGuestStore.getState().dismissOffer(200);
    const o = useGuestStore.getState().offers;
    expect(o.visible).toBeNull();
    expect(o.history).toEqual([
      { kind: 'pass-offer', triggerEventId: 'evt_london_2027', shownAt: 100, acted: 'details', dismissedAt: 200 },
    ]);
  });

  it('resetGuest — новий id і чистий стан', () => {
    useGuestStore.getState().setNick('Оля');
    useGuestStore.getState().addStamp(stamp('e1'));
    const id = useGuestStore.getState().id;
    useGuestStore.getState().resetGuest();
    const g = useGuestStore.getState();
    expect(g.id).not.toBe(id);
    expect(g.nick).toBeUndefined();
    expect(g.stamps).toEqual([]);
  });

  it('при збої localStorage сайт працює без збереження', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => useGuestStore.getState().setNick('Тарас')).not.toThrow();
    expect(useGuestStore.getState().nick).toBe('Тарас');
    expect(async () => useGuestStore.persist.rehydrate()).not.toThrow();
  });

  it('відновлення зі сховища; пошкоджений JSON — без падіння', async () => {
    localStorage.setItem(
      GUEST_STORAGE_KEY,
      JSON.stringify({ state: { ...createDefaultGuest(), id: 'dev-1', nick: 'Аміра' }, version: 1 }),
    );
    await useGuestStore.persist.rehydrate();
    expect(useGuestStore.getState()).toMatchObject({ id: 'dev-1', nick: 'Аміра' });

    localStorage.setItem(GUEST_STORAGE_KEY, '{not json');
    await expect(useGuestStore.persist.rehydrate()).resolves.not.toThrow();
  });

  it('зміна v → скидання без падіння', async () => {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ state: { v: 0, id: 'old', nick: 'Старий' }, version: 0 }));
    useGuestStore.getState().resetGuest();
    await useGuestStore.persist.rehydrate();
    expect(useGuestStore.getState().nick).toBeUndefined();
    expect(useGuestStore.getState().id).not.toBe('old');
    expect(sanitizeGuest({ v: 2, id: 'x' })).toBeNull();
  });

  it('інша ніч → скидання штампів, оцінок і пропозицій, нік лишається', () => {
    const old = {
      ...createDefaultGuest(),
      nick: 'Оля',
      nightId: '2025-26',
      stamps: [stamp('e1')],
      rate: { e1: { closed: true } },
    };
    const clean = sanitizeGuest(old)!;
    expect(clean.nick).toBe('Оля');
    expect(clean.stamps).toEqual([]);
    expect(clean.rate).toEqual({});
    expect(clean.nightId).toBe('2026-27');
  });

  it('старий стан з «Першим рядом» (прибрано 2026-11-12): поле `firstRow` і місце на штампі відкидаються, сайт не падає', async () => {
    const old = {
      ...createDefaultGuest(),
      nick: 'Оля',
      firstRow: { evt_london_2027: { seat: 3, draft: { name: 'Оля', greeting: '', emojiId: 'glasses' } } },
      stamps: [{ ...stamp('evt_london_2027'), firstRowSeat: 3 }],
    };
    const clean = sanitizeGuest(old)!;
    expect(clean.nick).toBe('Оля');
    expect('firstRow' in clean).toBe(false);
    expect(clean.stamps).toEqual([stamp('evt_london_2027')]);

    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ state: old, version: 1 }));
    await useGuestStore.persist.rehydrate();
    expect(useGuestStore.getState().nick).toBe('Оля');
    expect('firstRow' in useGuestStore.getState()).toBe(false);
    useGuestStore.getState().setNick('Оля');
    expect(saved()!.state.firstRow).toBeUndefined();
  });

  it('старий ключ «Першого ряду» `t2f:firstrow:v1` прибирається', () => {
    localStorage.setItem('t2f:firstrow:v1', JSON.stringify({ state: { passGifted: true }, version: 1 }));
    dropLegacyKeys();
    expect(localStorage.getItem('t2f:firstrow:v1')).toBeNull();
  });
});

describe('session store', () => {
  it('t2f:session:soundEnabled', async () => {
    const { useSessionStore } = await import('@/stores/session');
    useSessionStore.getState().setSoundEnabled(true);
    expect(sessionStorage.getItem(SOUND_KEY)).toBe('true');
    expect(useSessionStore.getState().soundEnabled).toBe(true);
  });
});
