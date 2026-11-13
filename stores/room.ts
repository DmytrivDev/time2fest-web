/**
 * Кімната перегляду (S-ROOM, US3, FR-030…FR-032; C21).
 *
 * Вікна й вікно зі звуком живуть у `guest.room` (`localStorage`, `stores/guest`): `windows` — у порядку показу,
 * `slot` — сталий номер вікна (для слота плеєра `room:N`), `soundSlot` — номер вікна зі звуком (≤ 1 вікна).
 * Перше вікно (`windows[0]`) — це спільний `PlayerHost` макета (головне вікно, єдине з автозапуском, FR-040; політика YouTube).
 *
 * Тут же — стан сеансу, який не зберігається:
 * - `pickTarget` — трансляція, що чекає місця, коли кімната повна (десктоп — режим вибору вікна для заміни;
 *   телефон — пояснення «до 2 вікон», нове вікно стає на місце прибраного);
 * - `started` — вікна 2–4, які людина запустила в цьому сеансі («Грати», «Звук сюди», клавіші 1–4). Нові (+), замінені,
 *   повернені й відновлені зі збереження вікна не стартують самі (автозапуск — лише в головного плеєра): `ResumeCard`
 *   до натискання.
 *
 * Чисті функції (`addWindow`, `removeWindow`, …) не читають сховищ — їх перевіряють юніт-тести.
 */
import { create } from 'zustand';
import type { GuestRoomWindow } from '@/lib/data/types';
import { useGuestStore } from '@/stores/guest';

export type RoomViewport = 'desktop' | 'phone';

/** Ліміти вікон за шириною (FR-030): десктоп 1–4, телефон до 2. */
export const ROOM_LIMIT: Readonly<Record<RoomViewport, number>> = { desktop: 4, phone: 2 };

export function roomLimit(viewport: RoomViewport): number {
  return ROOM_LIMIT[viewport];
}

/** Трансляція, яку додають у кімнату. */
export interface RoomTarget {
  sourceId: string;
  eventId: string;
}

export interface RoomState {
  windows: readonly GuestRoomWindow[];
  soundSlot: number | null;
}

export type AddResult =
  | { kind: 'added'; state: RoomState; slot: number }
  | { kind: 'duplicate'; state: RoomState; slot: number }
  | { kind: 'full'; state: RoomState };

/** Найменший вільний номер вікна. */
export function nextSlot(windows: readonly GuestRoomWindow[]): number {
  const used = new Set(windows.map((w) => w.slot));
  let n = 0;
  while (used.has(n)) n++;
  return n;
}

/** Місце вікна в сітці (0 — верхнє ліве … 3 — нижнє праве); старі збереження без `pos` — за порядком. */
export function posOf(w: GuestRoomWindow, index: number): number {
  return w.pos ?? index;
}

/** Найменше вільне місце в сітці. */
export function freePos(windows: readonly GuestRoomWindow[]): number {
  const used = new Set(windows.map((w, i) => posOf(w, i)));
  let n = 0;
  while (used.has(n)) n++;
  return n;
}

/**
 * `windows` — завжди за місцями в сітці (перше — головне), у кожного вікна є `pos`; `soundSlot` вказує на наявне
 * вікно або `null`. Місця сталі (власник 2026-11-06): прибране вікно лишає порожнє місце, решта не зсуваються.
 */
export function normalizeRoom(state: RoomState): RoomState {
  const uniq = state.windows.filter((w, i, all) => all.findIndex((x) => x.slot === w.slot) === i);
  const used = new Set<number>();
  const placed = uniq.map((w, i) => {
    let pos = posOf(w, i);
    while (used.has(pos)) pos++;
    used.add(pos);
    return w.pos === pos ? w : { ...w, pos };
  });
  const windows = [...placed].sort((a, b) => a.pos! - b.pos!);
  const sound = windows.some((w) => w.slot === state.soundSlot)
    ? state.soundSlot
    : (windows[0]?.slot ?? null);
  return { windows, soundSlot: sound };
}

export function addWindow(state: RoomState, target: RoomTarget, limit: number): AddResult {
  const existing = state.windows.find((w) => w.sourceId === target.sourceId);
  if (existing) return { kind: 'duplicate', state, slot: existing.slot };
  if (state.windows.length >= limit) return { kind: 'full', state };
  const slot = nextSlot(state.windows);
  const pos = freePos(state.windows);
  const windows = [
    ...state.windows,
    { slot, pos, sourceId: target.sourceId, eventId: target.eventId },
  ];
  return { kind: 'added', slot, state: normalizeRoom({ windows, soundSlot: state.soundSlot }) };
}

/** Останнє вікно не прибирається (× неактивний). Місце прибраного лишається порожнім; звук — на перше вікно. */
export function removeWindow(state: RoomState, slot: number): RoomState {
  if (state.windows.length <= 1) return state;
  const fixed = normalizeRoom(state).windows;
  const windows = fixed.filter((w) => w.slot !== slot);
  if (windows.length === fixed.length) return state;
  const soundSlot = state.soundSlot === slot ? (windows[0]?.slot ?? null) : state.soundSlot;
  return normalizeRoom({ windows, soundSlot });
}

/** Нова трансляція на місці вікна `slot` (той самий номер і місце; звук лишається за вікном). */
export function replaceWindow(state: RoomState, slot: number, target: RoomTarget): RoomState {
  const dup = state.windows.find((w) => w.sourceId === target.sourceId);
  if (dup && dup.slot !== slot) return state;
  const windows = normalizeRoom(state).windows.map((w) =>
    w.slot === slot ? { slot, pos: w.pos, sourceId: target.sourceId, eventId: target.eventId } : w,
  );
  return normalizeRoom({ windows, soundSlot: state.soundSlot });
}

export function setSound(state: RoomState, slot: number): RoomState {
  if (!state.windows.some((w) => w.slot === slot)) return state;
  return { ...state, soundSlot: slot };
}

/**
 * Перенести вікно `slot` на місце `pos` (перетягування за смугу, власник 2026-11-05/06): місце зайняте — вікна
 * міняються місцями, вільне — вікно просто переходить туди. Плеєри не перезапускаються: DOM вікон не переставляється,
 * позицію задає CSS `order`.
 */
export function moveWindow(state: RoomState, slot: number, pos: number): RoomState {
  const fixed = normalizeRoom(state).windows;
  const w = fixed.find((x) => x.slot === slot);
  if (!w || w.pos === pos) return state;
  const other = fixed.find((x) => x.pos === pos);
  const windows = fixed.map((x) =>
    x.slot === slot ? { ...x, pos } : other && x.slot === other.slot ? { ...x, pos: w.pos } : x,
  );
  return normalizeRoom({ windows, soundSlot: state.soundSlot });
}

/** Поміняти місцями два вікна. */
export function swapWindows(state: RoomState, a: number, b: number): RoomState {
  const fixed = normalizeRoom(state).windows;
  const wb = fixed.find((w) => w.slot === b);
  if (!wb || a === b) return state;
  return moveWindow(state, a, wb.pos!);
}

/** Повернути прибране вікно на його місце (сповіщення «Повернути»); місце зайняте — на найближче вільне. */
export function restoreWindow(
  state: RoomState,
  win: GuestRoomWindow,
  pos: number,
  limit: number,
  sound: boolean,
): RoomState {
  if (state.windows.length >= limit || state.windows.some((w) => w.sourceId === win.sourceId))
    return state;
  const fixed = normalizeRoom(state).windows;
  const slot = fixed.some((w) => w.slot === win.slot) ? nextSlot(fixed) : win.slot;
  const at = fixed.some((w) => w.pos === pos) ? freePos(fixed) : pos;
  const windows = [...fixed, { ...win, slot, pos: at }];
  return normalizeRoom({ windows, soundSlot: sound ? slot : state.soundSlot });
}

/** Перенести вікно на перше місце (головне вікно — те, що вже грає в `PlayerHost`). */
export function moveToFront(state: RoomState, slot: number): RoomState {
  const fixed = normalizeRoom(state).windows;
  const first = fixed[0];
  if (!first || first.slot === slot) return state;
  return moveWindow(state, slot, Math.min(first.pos!, 0));
}

/**
 * Головне вікно = те, що грає в `PlayerHost` (перехід «країна → кімната» не перезапускає відео, FR-042).
 * Уже є в кімнаті → на перше місце; немає → стає першим вікном (хто був на першому — на вільне місце), а зайве за
 * лімітом прибирається з останнього місця.
 */
export function adoptMain(state: RoomState, main: RoomTarget, limit: number): RoomState {
  const found = state.windows.find((w) => w.sourceId === main.sourceId);
  if (found) return moveToFront(state, found.slot);
  let fixed = normalizeRoom(state).windows;
  // Номер — вільний серед усіх вікон, навіть тих, що зараз обріжемо (слот плеєра прибраного вікна не перевикористовуємо).
  const slot = nextSlot(fixed);
  const max = Math.max(1, limit);
  if (fixed.length >= max) fixed = fixed.slice(0, max - 1);
  const occupant = fixed.find((w) => w.pos === 0);
  const moved = occupant
    ? fixed.map((w) => (w.slot === occupant.slot ? { ...w, pos: freePos(fixed) } : w))
    : fixed;
  const windows = [{ slot, pos: 0, sourceId: main.sourceId, eventId: main.eventId }, ...moved];
  return normalizeRoom({ windows, soundSlot: state.soundSlot ?? slot });
}

// ── Сховище ────────────────────────────────────────────────────────────────

export interface RoomSessionState {
  pickTarget: RoomTarget | null;
  /** Вікна 2–4, запущені людиною в цьому сеансі. */
  started: number[];
  /**
   * Вікно, у якому сидить спільний `PlayerHost` макета (головний плеєр). Не обов’язково перше в сітці: після
   * перетягування позиції змінюються, а плеєри — ні. `null` — перше вікно.
   */
  hostSlot: number | null;
}

export interface RoomActions {
  /**
   * «+»: додати трансляцію. `main` — те, що зараз грає головне вікно (сторінка країни): порожня кімната
   * починається з нього. Повна кімната → `pickTarget` (режим вибору / пояснення на телефоні).
   */
  add(target: RoomTarget, viewport: RoomViewport, main?: RoomTarget | null): AddResult['kind'];
  remove(slot: number): void;
  /** Замінити вікно трансляцією з `pickTarget` (або `target`). */
  replace(slot: number, target?: RoomTarget): void;
  setSound(slot: number): void;
  /** Поміняти місцями два вікна (див. `swapWindows`). */
  swap(a: number, b: number): void;
  /** Перенести вікно на місце сітки (див. `moveWindow`). */
  move(slot: number, pos: number): void;
  /** Повернути прибране вікно (див. `restoreWindow`). */
  restore(win: GuestRoomWindow, pos: number, viewport: RoomViewport, sound: boolean): void;
  setHostSlot(slot: number | null): void;
  cancelPick(): void;
  markStarted(slot: number): void;
  /** Див. `adoptMain`. */
  adoptMain(main: RoomTarget, viewport: RoomViewport): void;
  /** Тести. */
  resetSession(): void;
}

export type RoomStore = RoomSessionState & RoomActions;

function readRoom(): RoomState {
  const r = useGuestStore.getState().room;
  return { windows: r.windows, soundSlot: r.soundSlot };
}

function writeRoom(next: RoomState): void {
  const g = useGuestStore.getState();
  const prev = g.room;
  if (prev.windows !== next.windows) g.setRoomWindows([...next.windows]);
  if (prev.soundSlot !== next.soundSlot) g.setSoundSlot(next.soundSlot);
}

export const useRoomStore = create<RoomStore>()((set, get) => ({
  pickTarget: null,
  started: [],
  hostSlot: null,

  add(target, viewport, main) {
    let state = readRoom();
    const limit = roomLimit(viewport);
    if (!state.windows.length && main && main.sourceId !== target.sourceId) {
      const seeded = addWindow(state, main, limit);
      state = seeded.state;
    }
    const res = addWindow(state, target, limit);
    if (res.kind === 'full') {
      writeRoom(state);
      set({ pickTarget: target });
      return 'full';
    }
    writeRoom(res.state);
    // Нове вікно (не головне) НЕ грає саме (політика YouTube: автозапуск — лише в одного плеєра): фасад «Грати».
    set({ pickTarget: null });
    return res.kind;
  },

  remove(slot) {
    const before = readRoom();
    const next = removeWindow(before, slot);
    if (next === before) return;
    const pick = get().pickTarget;
    set((s) => ({ started: s.started.filter((x) => x !== slot) }));
    // Телефон: кімната була повна, нове вікно стає на звільнене місце.
    if (pick) {
      const res = addWindow(next, pick, before.windows.length);
      if (res.kind !== 'full') {
        writeRoom(res.state);
        set({ pickTarget: null });
        return;
      }
    }
    writeRoom(next);
  },

  replace(slot, target) {
    const t = target ?? get().pickTarget;
    if (!t) return;
    const before = readRoom();
    const next = replaceWindow(before, slot, t);
    if (next !== before) {
      writeRoom(next);
      // Нова трансляція на місці вікна — знову «готове» (фасад), само не грає.
      set((s) => ({ started: s.started.filter((x) => x !== slot) }));
    }
    set({ pickTarget: null });
  },

  setSound(slot) {
    writeRoom(setSound(readRoom(), slot));
  },

  swap(a, b) {
    const before = readRoom();
    const next = swapWindows(before, a, b);
    if (next !== before) writeRoom(next);
  },

  move(slot, pos) {
    const before = readRoom();
    const next = moveWindow(before, slot, pos);
    if (next !== before) writeRoom(next);
  },

  restore(win, pos, viewport, sound) {
    const before = readRoom();
    const next = restoreWindow(before, win, pos, roomLimit(viewport), sound);
    if (next === before) return;
    writeRoom(next);
  },

  setHostSlot(slot) {
    set({ hostSlot: slot });
  },

  cancelPick() {
    set({ pickTarget: null });
  },

  markStarted(slot) {
    set((s) => (s.started.includes(slot) ? s : { started: [...s.started, slot] }));
  },

  adoptMain(main, viewport) {
    const before = readRoom();
    const next = adoptMain(before, main, roomLimit(viewport));
    if (next !== before) writeRoom(next);
  },

  resetSession() {
    set({ pickTarget: null, started: [], hostSlot: null });
  },
}));

/** Вікна й звук кімнати (з `guest.room`, нормалізовані). */
export function useRoom(): RoomState {
  const windows = useGuestStore((s) => s.room.windows);
  const soundSlot = useGuestStore((s) => s.room.soundSlot);
  const sound = windows.some((w) => w.slot === soundSlot) ? soundSlot : (windows[0]?.slot ?? null);
  return { windows, soundSlot: sound };
}
