import { beforeEach, describe, expect, it } from 'vitest';
import type { GuestRoomWindow } from '@/lib/data/types';
import {
  addWindow,
  adoptMain,
  nextSlot,
  normalizeRoom,
  removeWindow,
  replaceWindow,
  ROOM_LIMIT,
  setSound,
  useRoomStore,
  type RoomState,
  type RoomTarget,
} from '@/stores/room';
import { GUEST_STORAGE_KEY, useGuestStore } from '@/stores/guest';

const t = (n: number | string): RoomTarget => ({ sourceId: `src_${n}`, eventId: `evt_${n}` });
const win = (slot: number, n: number | string = slot): GuestRoomWindow => ({ slot, sourceId: `src_${n}`, eventId: `evt_${n}` });
const room = (windows: GuestRoomWindow[], soundSlot: number | null = windows[0]?.slot ?? null): RoomState => ({ windows, soundSlot });

const slots = (s: RoomState) => s.windows.map((w) => w.slot);
const guestRoom = () => useGuestStore.getState().room;
const store = () => useRoomStore.getState();
const savedRoom = () =>
  (JSON.parse(localStorage.getItem(GUEST_STORAGE_KEY) ?? 'null') as { state: { room: { windows: GuestRoomWindow[]; soundSlot: number | null } } } | null)
    ?.state.room;

/** Інваріант: звук — не більше ніж у одному вікні й указує на наявне вікно (або порожня кімната). */
function expectSoundInvariant(s: { windows: readonly GuestRoomWindow[]; soundSlot: number | null }) {
  if (s.windows.length === 0) {
    expect(s.soundSlot).toBeNull();
    return;
  }
  expect(s.windows.filter((w) => w.slot === s.soundSlot)).toHaveLength(1);
}

beforeEach(() => {
  localStorage.clear();
  useGuestStore.getState().resetGuest();
  store().resetSession();
});

describe('room · чисті функції', () => {
  it('ліміти: 4 на десктопі, 2 на телефоні', () => {
    expect(ROOM_LIMIT).toEqual({ desktop: 4, phone: 2 });
  });

  it('nextSlot — найменший вільний номер', () => {
    expect(nextSlot([])).toBe(0);
    expect(nextSlot([win(0), win(1)])).toBe(2);
    expect(nextSlot([win(0), win(2)])).toBe(1);
  });

  it('normalizeRoom: звук вказує на наявне вікно, дублікати слотів відкидаються', () => {
    expect(normalizeRoom({ windows: [], soundSlot: 3 })).toEqual({ windows: [], soundSlot: null });
    expect(normalizeRoom({ windows: [win(2), win(5)], soundSlot: 9 }).soundSlot).toBe(2);
    expect(normalizeRoom({ windows: [win(2), win(5)], soundSlot: 5 }).soundSlot).toBe(5);
    expect(normalizeRoom({ windows: [win(1, 'a'), win(1, 'b')], soundSlot: 1 }).windows).toHaveLength(1);
  });

  it('addWindow: додає в кінець; повна кімната → full; дубль → duplicate', () => {
    let s = room([win(0)]);
    const r1 = addWindow(s, t(1), 2);
    expect(r1.kind).toBe('added');
    if (r1.kind !== 'added') throw new Error('очікувалось added');
    expect(r1.slot).toBe(1);
    s = r1.state;
    expect(slots(s)).toEqual([0, 1]);
    expect(addWindow(s, t(2), 2)).toMatchObject({ kind: 'full' });
    expect(addWindow(s, t(1), 2)).toMatchObject({ kind: 'duplicate', slot: 1 });
    // дубль має пріоритет над «повна»
    expect(addWindow(s, t(0), 2)).toMatchObject({ kind: 'duplicate', slot: 0 });
  });

  it('removeWindow: останнє вікно не прибирається; звук прибраного → перше вікно', () => {
    const one = room([win(0)]);
    expect(removeWindow(one, 0)).toBe(one);
    const s = room([win(0), win(1), win(2)], 1);
    const next = removeWindow(s, 1);
    expect(slots(next)).toEqual([0, 2]);
    expect(next.soundSlot).toBe(0);
    expectSoundInvariant(next);
    // звук не в прибраному вікні — лишається
    expect(removeWindow(room([win(0), win(1), win(2)], 2), 1).soundSlot).toBe(2);
    // невідомий слот — без змін
    expect(removeWindow(s, 7)).toBe(s);
  });

  it('replaceWindow: той самий слот і місце; дубль в іншому вікні ігнорується; звук лишається за вікном', () => {
    const s = room([win(0), win(1), win(2)], 1);
    const next = replaceWindow(s, 1, t('new'));
    expect(next.windows[1]).toMatchObject({ slot: 1, sourceId: 'src_new', eventId: 'evt_new' });
    expect(slots(next)).toEqual([0, 1, 2]);
    expect(next.soundSlot).toBe(1);
    expect(replaceWindow(s, 1, t(2))).toBe(s);
    expect(replaceWindow(s, 1, t(1)).windows[1]!.sourceId).toBe('src_1');
  });

  it('setSound: лише наявний слот', () => {
    const s = room([win(0), win(1)]);
    expect(setSound(s, 1).soundSlot).toBe(1);
    expect(setSound(s, 5)).toBe(s);
  });

  describe('adoptMain', () => {
    it('існуюче вікно переходить на перше місце', () => {
      const s = room([win(0), win(1), win(2)], 2);
      const next = adoptMain(s, t(2), 4);
      // Сталі місця (2026-11-06): головне й те, що було першим, міняються місцями.
      expect(next.windows.map((w) => w.sourceId)).toEqual(['src_2', 'src_1', 'src_0']);
      expect(next.soundSlot).toBe(2);
    });

    it('уже перше — стан не змінюється', () => {
      const s = room([win(0), win(1)]);
      expect(adoptMain(s, t(0), 4)).toBe(s);
    });

    it('порожня кімната: головне — перше вікно зі звуком', () => {
      const next = adoptMain(room([]), t('m'), 4);
      expect(next.windows).toMatchObject([{ slot: 0, sourceId: 'src_m', eventId: 'evt_m' }]);
      expect(next.soundSlot).toBe(0);
    });

    it('нове головне вставляється першим, зайве з кінця обрізається до ліміту', () => {
      const s = room([win(0), win(1)], 0);
      const next = adoptMain(s, t('m'), 2);
      expect(next.windows.map((w) => w.sourceId)).toEqual(['src_m', 'src_0']);
      expect(next.windows).toHaveLength(2);
      expect(next.soundSlot).toBe(0);
      expectSoundInvariant(next);
    });

    it('звук обрізаного вікна переходить на перше', () => {
      const s = room([win(0), win(1)], 1);
      const next = adoptMain(s, t('m'), 2);
      expect(next.windows.map((w) => w.slot)).toEqual([2, 0]);
      expect(next.soundSlot).toBe(2);
      expectSoundInvariant(next);
    });
  });
});

describe('room · сховище (T095)', () => {
  it('десктоп: до 4 вікон, 5-те → full і pickTarget', () => {
    store().add(t(1), 'desktop', t(0));
    store().add(t(2), 'desktop');
    store().add(t(3), 'desktop');
    expect(guestRoom().windows).toHaveLength(4);
    expect(store().add(t(4), 'desktop')).toBe('full');
    expect(guestRoom().windows).toHaveLength(4);
    expect(store().pickTarget).toEqual(t(4));
  });

  it('телефон: до 2 вікон, 3-тє → full і pickTarget', () => {
    expect(store().add(t(1), 'phone', t(0))).toBe('added');
    expect(guestRoom().windows).toHaveLength(2);
    expect(store().add(t(2), 'phone')).toBe('full');
    expect(guestRoom().windows).toHaveLength(2);
    expect(store().pickTarget).toEqual(t(2));
  });

  it('дубль → duplicate, кімната не змінюється', () => {
    store().add(t(1), 'desktop', t(0));
    const before = guestRoom().windows;
    expect(store().add(t(1), 'desktop')).toBe('duplicate');
    expect(store().add(t(0), 'desktop')).toBe('duplicate');
    expect(guestRoom().windows).toEqual(before);
    expect(store().pickTarget).toBeNull();
  });

  it('порожня кімната + main: main стає вікном 1, потім додається ціль', () => {
    expect(store().add(t('target'), 'desktop', t('main'))).toBe('added');
    expect(guestRoom().windows).toMatchObject([
      { slot: 0, sourceId: 'src_main', eventId: 'evt_main' },
      { slot: 1, sourceId: 'src_target', eventId: 'evt_target' },
    ]);
    expect(guestRoom().soundSlot).toBe(0);
  });

  it('порожня кімната без main: ціль — перше вікно, не в started', () => {
    expect(store().add(t('target'), 'desktop')).toBe('added');
    expect(guestRoom().windows).toMatchObject([{ slot: 0, sourceId: 'src_target', eventId: 'evt_target' }]);
    expect(store().started).toEqual([]);
  });

  it('main == ціль на порожній кімнаті: одне вікно', () => {
    store().add(t('x'), 'desktop', t('x'));
    expect(guestRoom().windows).toHaveLength(1);
  });

  it('main ігнорується, коли кімната вже не порожня', () => {
    store().add(t(1), 'desktop', t(0));
    store().add(t(2), 'desktop', t('other-main'));
    expect(guestRoom().windows.map((w) => w.sourceId)).toEqual(['src_0', 'src_1', 'src_2']);
  });

  it('додані вікна (і перше) НЕ в started: само нічого не грає, лише від кліку (політика автозапуску YouTube)', () => {
    store().add(t(1), 'desktop', t(0));
    store().add(t(2), 'desktop');
    expect(store().started).toEqual([]);
    store().markStarted(2);
    expect(store().started).toEqual([2]);
  });

  it('звук: ≤ 1 вікна і вказує на наявне після add / setSound / remove / replace', () => {
    store().add(t(1), 'desktop', t(0));
    store().add(t(2), 'desktop');
    store().add(t(3), 'desktop');
    expectSoundInvariant(guestRoom());
    store().setSound(2);
    expect(guestRoom().soundSlot).toBe(2);
    expectSoundInvariant(guestRoom());
    store().setSound(42);
    expect(guestRoom().soundSlot).toBe(2);
    store().remove(2);
    expectSoundInvariant(guestRoom());
    expect(guestRoom().soundSlot).toBe(0);
    store().add(t(9), 'desktop');
    store().setSound(3);
    store().add(t(10), 'desktop'); // повна → pickTarget
    store().replace(3);
    expectSoundInvariant(guestRoom());
    expect(guestRoom().soundSlot).toBe(3);
  });

  it('останнє вікно не прибирається', () => {
    store().add(t(1), 'desktop', t(0));
    store().remove(1);
    expect(guestRoom().windows).toHaveLength(1);
    store().remove(0);
    expect(guestRoom().windows).toHaveLength(1);
    expect(guestRoom().windows[0]!.sourceId).toBe('src_0');
  });

  it('remove прибирає слот зі started', () => {
    store().add(t(1), 'desktop', t(0));
    store().markStarted(1);
    expect(store().started).toContain(1);
    store().remove(1);
    expect(store().started).not.toContain(1);
  });

  it('збереження: після дій localStorage[t2f:guest:v1] містить room.windows і soundSlot', () => {
    store().add(t(1), 'desktop', t(0));
    store().add(t(2), 'desktop');
    store().setSound(1);
    expect(savedRoom()).toEqual({ windows: guestRoom().windows, soundSlot: 1 });
    expect(savedRoom()!.windows.map((w) => w.sourceId)).toEqual(['src_0', 'src_1', 'src_2']);
    store().remove(2);
    expect(savedRoom()!.windows.map((w) => w.slot)).toEqual([0, 1]);
    expect(localStorage.getItem(GUEST_STORAGE_KEY)).toContain('"windows"');
  });

  it('відновлення: вікна зі сховища не в started (ResumeCard, без автозапуску)', async () => {
    store().add(t(1), 'desktop', t(0));
    store().add(t(2), 'desktop');
    const saved = localStorage.getItem(GUEST_STORAGE_KEY)!;
    // «перезавантаження»: сеансовий стан зникає, збережене лишається
    store().resetSession();
    useGuestStore.setState({ room: { windows: [], soundSlot: null } });
    localStorage.setItem(GUEST_STORAGE_KEY, saved);
    await useGuestStore.persist.rehydrate();
    expect(guestRoom().windows).toHaveLength(3);
    expect(store().started).toEqual([]);
  });

  it('вікна, виставлені прямо у guest-сховищі, не в started', () => {
    useGuestStore.getState().setRoomWindows([win(0), win(1), win(2)]);
    useGuestStore.getState().setSoundSlot(1);
    expect(store().started).toEqual([]);
    expect(guestRoom().soundSlot).toBe(1);
  });

  describe('телефон: вибір замість заповненого', () => {
    beforeEach(() => {
      store().add(t(1), 'phone', t(0));
      expect(store().add(t(2), 'phone')).toBe('full');
    });

    it('remove(slot) ставить очікувану ціль на звільнене місце і чистить pickTarget', () => {
      store().remove(0);
      expect(store().pickTarget).toBeNull();
      expect(guestRoom().windows).toHaveLength(2);
      const bySource = Object.fromEntries(guestRoom().windows.map((w) => [w.sourceId, w.slot]));
      expect(bySource['src_1']).toBe(1);
      expect(bySource['src_2']).toBe(0); // звільнений слот
      expect(store().started).not.toContain(0);
      expectSoundInvariant(guestRoom());
    });

    it('прибрано вікно зі звуком — звук лишається в існуючому вікні', () => {
      store().setSound(1);
      store().remove(1);
      expect(guestRoom().windows.map((w) => w.sourceId).sort()).toEqual(['src_0', 'src_2']);
      expectSoundInvariant(guestRoom());
    });

    it('cancelPick чистить pickTarget без змін кімнати', () => {
      const before = guestRoom().windows;
      store().cancelPick();
      expect(store().pickTarget).toBeNull();
      expect(guestRoom().windows).toEqual(before);
    });
  });

  describe('десктоп: режим заміни', () => {
    beforeEach(() => {
      store().add(t(1), 'desktop', t(0));
      store().add(t(2), 'desktop');
      store().add(t(3), 'desktop');
      expect(store().add(t('new'), 'desktop')).toBe('full');
    });

    it('replace(slot) з явною ціллю: слот і позиція ті самі, started скинуто', () => {
      store().resetSession();
      store().markStarted(1);
      store().replace(1, t('new'));
      expect(guestRoom().windows.map((w) => w.slot)).toEqual([0, 1, 2, 3]);
      expect(guestRoom().windows[1]).toMatchObject({ slot: 1, sourceId: 'src_new', eventId: 'evt_new' });
      expect(store().started).not.toContain(1);
    });

    it('replace(slot) без target бере pickTarget і чистить його', () => {
      expect(store().pickTarget).toEqual(t('new'));
      store().replace(2);
      expect(guestRoom().windows[2]).toMatchObject({ slot: 2, sourceId: 'src_new', eventId: 'evt_new' });
      expect(store().pickTarget).toBeNull();
      expect(store().started).not.toContain(2);
    });

    it('replace без pickTarget і target — нічого', () => {
      store().cancelPick();
      const before = guestRoom().windows;
      store().replace(1);
      expect(guestRoom().windows).toEqual(before);
    });

    it('replace дублем іншого вікна не змінює кімнату, але виходить з режиму вибору', () => {
      const before = guestRoom().windows;
      store().replace(1, t(2));
      expect(guestRoom().windows).toEqual(before);
      expect(store().pickTarget).toBeNull();
    });
  });

  describe('adoptMain у сховищі', () => {
    it('існуюче джерело — на перше місце', () => {
      store().add(t(1), 'desktop', t(0));
      store().adoptMain(t(1), 'desktop');
      expect(guestRoom().windows.map((w) => w.sourceId)).toEqual(['src_1', 'src_0']);
      expect(savedRoom()!.windows[0]!.sourceId).toBe('src_1');
    });

    it('нове джерело — першим, обрізання до ліміту телефона', () => {
      store().add(t(1), 'phone', t(0));
      store().adoptMain(t('m'), 'phone');
      const w = guestRoom().windows;
      expect(w).toHaveLength(2);
      expect(w[0]!.sourceId).toBe('src_m');
      expect(w[1]!.sourceId).toBe('src_0');
      expectSoundInvariant(guestRoom());
    });

    it('порожня кімната — одне вікно зі звуком', () => {
      store().adoptMain(t('m'), 'desktop');
      expect(guestRoom().windows).toHaveLength(1);
      expect(guestRoom().soundSlot).toBe(0);
    });
  });
});
