/**
 * Кімната перегляду (S-ROOM, US3, FR-030…FR-032; C21).
 *
 * Вікна й вікно зі звуком живуть у `guest.room` (`localStorage`, `stores/guest`): `windows` — у порядку показу,
 * `slot` — сталий номер вікна (для слота плеєра `room:N`), `soundSlot` — номер вікна зі звуком (≤ 1 вікна).
 * Перше вікно (`windows[0]`) — це спільний `PlayerHost` макета (головне вікно, єдине з автозапуском, FR-040).
 *
 * Тут же — стан сеансу, який не зберігається:
 * - `pickTarget` — трансляція, що чекає місця, коли кімната повна (десктоп — режим вибору вікна для заміни;
 *   телефон — пояснення «до 2 вікон», нове вікно стає на місце прибраного);
 * - `started` — вікна 2–4, які людина запустила в цьому сеансі («+», «Грати», «Звук сюди»). Відновлені зі
 *   збереження вікна не стартують самі: показують `ResumeCard` до натискання.
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

/** `soundSlot` завжди вказує на наявне вікно або `null`; порожня кімната — без звуку. */
export function normalizeRoom(state: RoomState): RoomState {
  const windows = state.windows.filter(
    (w, i, all) => all.findIndex((x) => x.slot === w.slot) === i,
  );
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
  const windows = [...state.windows, { slot, sourceId: target.sourceId, eventId: target.eventId }];
  return { kind: 'added', slot, state: normalizeRoom({ windows, soundSlot: state.soundSlot }) };
}

/** Останнє вікно не прибирається (× неактивний). Звук прибраного вікна переходить на перше вікно. */
export function removeWindow(state: RoomState, slot: number): RoomState {
  if (state.windows.length <= 1) return state;
  const windows = state.windows.filter((w) => w.slot !== slot);
  if (windows.length === state.windows.length) return state;
  const soundSlot = state.soundSlot === slot ? (windows[0]?.slot ?? null) : state.soundSlot;
  return normalizeRoom({ windows, soundSlot });
}

/** Нова трансляція на місці вікна `slot` (той самий номер і місце; звук лишається за вікном). */
export function replaceWindow(state: RoomState, slot: number, target: RoomTarget): RoomState {
  const dup = state.windows.find((w) => w.sourceId === target.sourceId);
  if (dup && dup.slot !== slot) return state;
  const windows = state.windows.map((w) =>
    w.slot === slot ? { slot, sourceId: target.sourceId, eventId: target.eventId } : w,
  );
  return normalizeRoom({ windows, soundSlot: state.soundSlot });
}

export function setSound(state: RoomState, slot: number): RoomState {
  if (!state.windows.some((w) => w.slot === slot)) return state;
  return { ...state, soundSlot: slot };
}

/**
 * Поміняти місцями два вікна (перетягування за смугу, власник 2026-11-05). Порядок у `windows` — це порядок показу;
 * плеєри не перезапускаються: DOM вікон не переставляється, позицію задає CSS `order`.
 */
export function swapWindows(state: RoomState, a: number, b: number): RoomState {
  const ia = state.windows.findIndex((w) => w.slot === a);
  const ib = state.windows.findIndex((w) => w.slot === b);
  if (ia < 0 || ib < 0 || ia === ib) return state;
  const windows = [...state.windows];
  [windows[ia], windows[ib]] = [windows[ib]!, windows[ia]!];
  return { ...state, windows };
}

/** Повернути прибране вікно на його місце (сповіщення «Повернути»). */
export function restoreWindow(
  state: RoomState,
  win: GuestRoomWindow,
  index: number,
  limit: number,
  sound: boolean,
): RoomState {
  if (state.windows.length >= limit || state.windows.some((w) => w.sourceId === win.sourceId))
    return state;
  const slot = state.windows.some((w) => w.slot === win.slot) ? nextSlot(state.windows) : win.slot;
  const windows = [...state.windows];
  windows.splice(Math.min(index, windows.length), 0, { ...win, slot });
  return normalizeRoom({ windows, soundSlot: sound ? slot : state.soundSlot });
}

/** Перенести вікно на перше місце (головне вікно — те, що вже грає в `PlayerHost`). */
export function moveToFront(state: RoomState, slot: number): RoomState {
  const idx = state.windows.findIndex((w) => w.slot === slot);
  if (idx <= 0) return state;
  const w = state.windows[idx]!;
  return { ...state, windows: [w, ...state.windows.filter((x) => x.slot !== slot)] };
}

/**
 * Головне вікно = те, що грає в `PlayerHost` (перехід «країна → кімната» не перезапускає відео, FR-042).
 * Уже є в кімнаті → на перше місце; немає → стає першим вікном, а зайве за лімітом прибирається з кінця.
 */
export function adoptMain(state: RoomState, main: RoomTarget, limit: number): RoomState {
  const found = state.windows.find((w) => w.sourceId === main.sourceId);
  if (found) return moveToFront(state, found.slot);
  const slot = nextSlot(state.windows);
  const windows = [
    { slot, sourceId: main.sourceId, eventId: main.eventId },
    ...state.windows,
  ].slice(0, Math.max(1, limit));
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
  /** Повернути прибране вікно (див. `restoreWindow`). */
  restore(win: GuestRoomWindow, index: number, viewport: RoomViewport, sound: boolean): void;
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
    // «+» — дія людини: нове вікно (не головне) стартує одразу, без звуку.
    if (res.kind === 'added' && res.state.windows[0]?.slot !== res.slot)
      get().markStarted(res.slot);
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
        if (res.kind === 'added') get().markStarted(res.slot);
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
      get().markStarted(slot);
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

  restore(win, index, viewport, sound) {
    const before = readRoom();
    const next = restoreWindow(before, win, index, roomLimit(viewport), sound);
    if (next === before) return;
    writeRoom(next);
    const slot = next.windows[Math.min(index, next.windows.length - 1)]?.slot;
    if (slot !== undefined) get().markStarted(slot);
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
