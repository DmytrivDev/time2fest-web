/**
 * Стан гостя (`data-model.md`, розділ 2) у `localStorage['t2f:guest:v1']`.
 * Кожне читання й запис — у `try/catch` (`safeJsonStorage`); при збої сайт працює без збереження.
 * Зміна `v` → міграція або скидання; інша ніч (`nightId`) → скидання штампів, оцінок і пропозицій.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  GuestConsent,
  GuestFirstRowEntry,
  GuestRoomWindow,
  GuestState,
  NightId,
  OfferEntry,
  OfferKind,
  PresenceSource,
  RoomId,
  Stamp,
  Stars,
} from '@/lib/data/types';
import { safeJsonStorage } from '@/lib/storage/safe';
import { clearMapHintSeen } from '@/lib/storage/mapHint';
import { replaceCountryZone, toggleCountryZone } from '@/lib/schedule/countryZone';
import { detectFlag } from '@/lib/geo/detectFlag';

export const GUEST_STORAGE_KEY = 't2f:guest:v1';
export const GUEST_VERSION = 1 as const;
export const CURRENT_NIGHT: NightId = '2026-27';
/** Скільки останніх відправлень пам’ятати для повільного режиму. */
export const SENT_HISTORY = 20;

export function newGuestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // ігноруємо
  }
  return 'g-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createDefaultGuest(): GuestState {
  return {
    v: GUEST_VERSION,
    id: newGuestId(),
    locale: 'uk',
    consent: { answered: false, necessary: true, analytics: false, marketing: false, facebookVideo: false },
    reducedMotion: false,
    chatHidden: false,
    zoneStreamsCollapsed: false,
    chat: { lastRoom: 'world', sentAt: [] },
    room: { windows: [], soundSlot: null },
    stamps: [],
    stampsDismissed: [],
    pendingPresence: {},
    rate: {},
    offers: { nightId: CURRENT_NIGHT, history: [], visible: null },
    schedule: [],
    hasPass: false,
    firstRow: {},
    nightId: CURRENT_NIGHT,
  };
}

export interface GuestActions {
  resetGuest(): void;
  setNick(nick: string, flagCode?: string): void;
  setFlag(flagCode: string): void;
  setDetectedFlag(flagCode: string | undefined): void;
  /**
   * Прапор профілю заданий одразу (правка власника 2026-11-10): немає обраного — береться визначений за IP (`detectFlag`).
   * Викликається при кожному вході й створенні акаунта (`stores/auth.ts`), щоб шапка, кабінет і чат показували прапор без затримки.
   */
  ensureProfileFlag(): void;
  setConsent(patch: Partial<Omit<GuestConsent, 'necessary' | 'answered'>>): void;
  setReducedMotion(v: boolean): void;
  setChatHidden(v: boolean): void;
  setZoneStreamsCollapsed(v: boolean): void;
  setLastRoom(room: RoomId): void;
  recordSent(at: number): void;
  setRoomWindows(windows: GuestRoomWindow[]): void;
  setSoundSlot(slot: number | null): void;
  /** `false`, якщо штамп на цю подію вже є (штамп один на подію). */
  addStamp(stamp: Stamp): boolean;
  /** «×» на штампі під плеєром: більше не показувати штамп цих подій. */
  dismissStamps(eventIds: readonly string[]): void;
  markPresence(eventId: string, at: number, source: PresenceSource): void;
  setRate(eventId: string, patch: { stars?: Stars; closed?: boolean }): void;
  showOffer(kind: OfferKind, triggerEventId: string, at: number): void;
  /** `kind` — закрити саме цю пропозицію (блок під штампом), а не ту, що зараз у `visible`. */
  dismissOffer(at: number, kind?: OfferKind): void;
  actOffer(acted: 'primary' | 'details', kind?: OfferKind): void;
  hideOffer(): void;
  /** Календарик: додати країну в поясі чи прибрати; повний пояс (усі слоти зайняті) — без змін. */
  toggleSchedule(eventId: string): void;
  /** «Замінити в графіку?»: країна `outIso` поясу події поступається місцем країні цієї події. */
  replaceSchedule(outIso: string, eventId: string): void;
  setSchedule(eventIds: string[]): void;
  setHasPass(v: boolean): void;
  updateFirstRow(eventId: string, patch: Partial<GuestFirstRowEntry> | ((prev: GuestFirstRowEntry) => GuestFirstRowEntry)): void;
}

export type GuestStore = GuestState & GuestActions;

const DATA_KEYS = [
  ...(Object.keys(createDefaultGuest()) as (keyof GuestState)[]),
  'nick',
  'flagCode',
  'detectedFlag',
] as (keyof GuestState)[];

function pickData(s: GuestStore): GuestState {
  const out = {} as Record<string, unknown>;
  for (const k of DATA_KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as unknown as GuestState;
}

/** Приводить збережене до поточної форми; несумісне → `null` (скидання). */
export function sanitizeGuest(raw: unknown): GuestState | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<GuestState>;
  if (p.v !== GUEST_VERSION || typeof p.id !== 'string') return null;
  const base = createDefaultGuest();
  const merged: GuestState = {
    ...base,
    ...p,
    consent: { ...base.consent, ...(p.consent ?? {}), necessary: true },
    chat: { ...base.chat, ...(p.chat ?? {}) },
    room: { ...base.room, ...(p.room ?? {}) },
    offers: { ...base.offers, ...(p.offers ?? {}) },
  } as GuestState;
  if (merged.nightId !== CURRENT_NIGHT) {
    merged.nightId = CURRENT_NIGHT;
    merged.stamps = [];
    merged.stampsDismissed = [];
    merged.rate = {};
    merged.pendingPresence = {};
    merged.offers = base.offers;
  }
  if (!Array.isArray(merged.stamps)) merged.stamps = [];
  return merged;
}

export const useGuestStore = create<GuestStore>()(
  persist(
    (set, get) => ({
      ...createDefaultGuest(),

      resetGuest: () => set({ ...createDefaultGuest(), nick: undefined, flagCode: undefined, detectedFlag: undefined }),
      setNick: (nick, flagCode) => set(flagCode ? { nick, flagCode } : { nick }),
      setFlag: (flagCode) => set({ flagCode }),
      setDetectedFlag: (detectedFlag) => set({ detectedFlag }),
      ensureProfileFlag: () => {
        const s = get();
        const detected = s.detectedFlag ?? detectFlag();
        if (!detected) return;
        const patch: Partial<GuestState> = {};
        if (!s.detectedFlag) patch.detectedFlag = detected;
        if (!s.flagCode) patch.flagCode = detected;
        if (Object.keys(patch).length > 0) set(patch);
      },
      setConsent: (patch) => set((s) => ({ consent: { ...s.consent, ...patch, necessary: true, answered: true } })),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setChatHidden: (chatHidden) => set({ chatHidden }),
      setZoneStreamsCollapsed: (zoneStreamsCollapsed) => set({ zoneStreamsCollapsed }),
      setLastRoom: (lastRoom) => set((s) => ({ chat: { ...s.chat, lastRoom } })),
      recordSent: (at) => set((s) => ({ chat: { ...s.chat, sentAt: [...s.chat.sentAt, at].slice(-SENT_HISTORY) } })),
      setRoomWindows: (windows) => set((s) => ({ room: { ...s.room, windows } })),
      setSoundSlot: (soundSlot) => set((s) => ({ room: { ...s.room, soundSlot } })),
      addStamp: (stamp) => {
        if (get().stamps.some((x) => x.eventId === stamp.eventId)) return false;
        set((s) => ({ stamps: [...s.stamps, stamp] }));
        return true;
      },
      dismissStamps: (eventIds) =>
        set((s) => ({ stampsDismissed: [...new Set([...(s.stampsDismissed ?? []), ...eventIds])] })),
      markPresence: (eventId, at, source) =>
        set((s) => (s.pendingPresence[eventId] ? s : { pendingPresence: { ...s.pendingPresence, [eventId]: { at, source } } })),
      setRate: (eventId, patch) =>
        set((s) => {
          const prev = s.rate[eventId] ?? { closed: false };
          return { rate: { ...s.rate, [eventId]: { ...prev, ...patch } } };
        }),
      showOffer: (kind, triggerEventId, at) =>
        set((s) => {
          const entry: OfferEntry = { kind, triggerEventId, shownAt: at };
          return { offers: { ...s.offers, history: [...s.offers.history, entry], visible: kind } };
        }),
      dismissOffer: (at, kind) =>
        set((s) => {
          const visible = s.offers.visible;
          const target = kind ?? visible;
          if (!target) return s;
          const history = [...s.offers.history];
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]!.kind === target) {
              history[i] = { ...history[i]!, dismissedAt: at };
              break;
            }
          }
          return { offers: { ...s.offers, history, visible: visible === target ? null : visible } };
        }),
      actOffer: (acted, kind) =>
        set((s) => {
          const target = kind ?? s.offers.visible;
          if (!target) return s;
          const history = [...s.offers.history];
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]!.kind === target) {
              history[i] = { ...history[i]!, acted };
              break;
            }
          }
          return { offers: { ...s.offers, history } };
        }),
      hideOffer: () => set((s) => ({ offers: { ...s.offers, visible: null } })),
      // Графік — це країни: подія тягне за собою інші події тієї самої країни в тому самому поясі (рішення 2026-11-04).
      toggleSchedule: (eventId) => set((s) => ({ schedule: toggleCountryZone(s.schedule, eventId) })),
      replaceSchedule: (outIso, eventId) => set((s) => ({ schedule: replaceCountryZone(s.schedule, outIso, eventId) })),
      setSchedule: (schedule) => set({ schedule: [...new Set(schedule)] }),
      setHasPass: (hasPass) => set({ hasPass }),
      updateFirstRow: (eventId, patch) =>
        set((s) => {
          const prev = s.firstRow[eventId] ?? {};
          const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
          return { firstRow: { ...s.firstRow, [eventId]: next } };
        }),
    }),
    {
      name: GUEST_STORAGE_KEY,
      version: GUEST_VERSION,
      storage: safeJsonStorage<GuestState>('local'),
      partialize: (s) => pickData(s),
      // Інша версія: міграцій ще немає → скидання без падіння.
      migrate: (persisted, version) => (version === GUEST_VERSION ? (persisted as GuestState) : createDefaultGuest()),
      merge: (persisted, current) => {
        const clean = sanitizeGuest(persisted);
        return clean ? { ...current, ...clean } : current;
      },
    },
  ),
);

export function resetGuest(): void {
  // Новий гість бачить мапу вперше — підказка жестів покажеться знову.
  clearMapHintSeen();
  useGuestStore.getState().resetGuest();
}
