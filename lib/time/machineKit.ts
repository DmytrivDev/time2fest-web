/**
 * «Машина часу» тестової збірки (`contracts/time-machine.md`, SPEC-07): локальна `TimeMachine` (sim і демо),
 * серверна `ServerTimeMachine` (інтеграційна test + http), збереження стану й адреса.
 * Модуль вантажить лише `machineLoader` у гілці, яку збирач відсікає в робочій, передстартовій і репетиційній
 * збірках, — там у пакеті немає ні машини, ні її ключа сховища (AC-58, NFR-3). Інші модулі сайту сюди не імпортують.
 */
import { IS_DEMO_BUILD } from '@/lib/env';
import { parseMachineParams, safeLocalStorage, safeSessionStorage, writeMachineToUrl } from './machineParams';
import type { AppTimeSource } from './params';
import { ServerTimeMachine } from './serverTimeMachine';
import { sanitizeSpeed } from './speed';
import { DEFAULT_START_MS, DEMO_START_MS, MACHINE_STORAGE_KEY, TimeMachine } from './timeMachine';

export { DEMO_START_MS, ServerTimeMachine, TimeMachine };

export interface SavedMachine {
  at: number;
  speed: number;
  savedAtMs: number;
}

export function readSavedMachine(storage: Storage | null | undefined): SavedMachine | null {
  try {
    const raw = storage?.getItem(MACHINE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedMachine>;
    if (typeof v.at !== 'number' || typeof v.savedAtMs !== 'number' || !Number.isFinite(v.at)) return null;
    return { at: v.at, speed: sanitizeSpeed(v.speed), savedAtMs: v.savedAtMs };
  } catch {
    return null;
  }
}

export function saveMachine(storage: Storage | null | undefined, state: SavedMachine): void {
  try {
    storage?.setItem(MACHINE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // сховище недоступне — працюємо без збереження
  }
}

export interface MachineStart {
  at: number;
  speed: number;
  panel: boolean;
  warnings: string[];
  origin: 'param' | 'saved' | 'default';
}

/**
 * Стартовий стан машини: явний `t` перемагає збережене; збережене доганяє за формулою
 * `at + (Date.now() − savedAtMs) × speed`; інакше — `2027-01-01T01:38:00+02:00`.
 * Поза тестовою збіркою — `null` (параметри ігноруються).
 */
export function resolveMachineStart(opts: {
  search: string;
  isTest: boolean;
  storage?: Storage | null;
  dateNow?: () => number;
  /** Старт без `t` і без збереженого (демо — `DEMO_START_MS`). */
  defaultAt?: number;
}): MachineStart | null {
  if (!opts.isTest) return null;
  const p = parseMachineParams(opts.search);
  const base = { panel: p.panel, warnings: p.warnings };
  if (p.at !== undefined) return { ...base, at: p.at, speed: p.speed ?? 1, origin: 'param' };
  const saved = readSavedMachine(opts.storage);
  if (saved) {
    const elapsed = Math.max(0, (opts.dateNow ?? Date.now)() - saved.savedAtMs);
    return { ...base, at: saved.at + elapsed * saved.speed, speed: p.speed ?? saved.speed, origin: 'saved' };
  }
  return { ...base, at: opts.defaultAt ?? DEFAULT_START_MS, speed: p.speed ?? 1, origin: 'default' };
}

/**
 * Зв’язує машину зі сховищем сеансу й адресою: кожна зміна (`set`, `advance`) зберігається
 * й пишеться в адресу; при `pagehide` у адресу пишеться поточний віртуальний час,
 * щоб оновлення сторінки продовжило, а не повернуло на старт.
 */
export function attachMachinePersistence(
  machine: TimeMachine,
  opts: { storage?: Storage | null; win?: Window | null; dateNow?: () => number; writeUrl?: boolean } = {},
): () => void {
  const win = opts.win === undefined ? (typeof window !== 'undefined' ? window : null) : opts.win;
  const storage = opts.storage === undefined ? safeSessionStorage() : opts.storage;
  const dateNow = opts.dateNow ?? Date.now;
  const persist = (writeUrl: boolean) => {
    const s = machine.get();
    saveMachine(storage, { at: s.at, speed: s.speed, savedAtMs: dateNow() });
    if (writeUrl && win && opts.writeUrl !== false) writeMachineToUrl(s, win);
  };
  persist(false);
  const unsub = machine.subscribe(() => persist(true));
  const onHide = () => persist(true);
  win?.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    win?.removeEventListener('pagehide', onHide);
  };
}

/** Прибирає `t` і `speed` з адреси: стан уже на сервері, оновлення сторінки бере його з дверцят (AC-59), а не перезаписує. */
function dropMachineParams(win: Window): void {
  try {
    const url = new URL(win.location.href);
    if (!url.searchParams.has('t') && !url.searchParams.has('speed')) return;
    url.searchParams.delete('t');
    url.searchParams.delete('speed');
    win.history.replaceState(win.history.state, '', url.toString());
  } catch {
    // без адреси — не критично
  }
}

/**
 * Інтеграційна збірка (SPEC-07): машина на тестовому годиннику сервера. Дійсні `?t=` / `?speed=` — один `POST`
 * (AC-60); недійсні — `[time-machine]` попередження й жодного `POST` (AC-62); без них — стан дверцят (AC-59), без сховища.
 */
function createServerMachineSource(win: Window): AppTimeSource {
  const p = parseMachineParams(win.location.search);
  for (const w of p.warnings) console.warn(`[time-machine] ${w}`);
  const initial =
    p.warnings.length > 0
      ? undefined
      : p.at !== undefined
        ? { at: p.at, speed: p.speed ?? 1 }
        : p.speed !== undefined
          ? { speed: p.speed }
          : undefined;
  const machine = new ServerTimeMachine({
    endpoint: '/api/_test/clock',
    onUnreachable: () => console.warn('[time-machine] /api/_test/clock недоступний, повтор під час опитування'),
  });
  return {
    source: machine,
    machine,
    start: null,
    activate: () => {
      machine.start(initial);
      if (initial) dropMachineParams(win);
      return () => machine.stop();
    },
  };
}

/** Джерело часу тестової збірки з машиною: серверна (test + http) або локальна (sim, демо). */
export function createMachineSource(win: Window): AppTimeSource | null {
  // Інтеграційна збірка (test + http): машина на тестовому годиннику сервера (SPEC-07, FR-CLK-15).
  if (process.env.NEXT_PUBLIC_ENV === 'test' && process.env.NEXT_PUBLIC_API_MODE === 'http') {
    return createServerMachineSource(win);
  }
  // `sim` (тестова й демо): локальна машина часу, як до SPEC-07 (AC-63).
  // Демо: час спільний для вкладок і переживає закриття (localStorage, «Скинути стан гостя» його стирає), адреса — без `t`.
  const storage = IS_DEMO_BUILD ? safeLocalStorage() : safeSessionStorage();
  const start = resolveMachineStart({
    search: win.location.search,
    isTest: true,
    storage,
    ...(IS_DEMO_BUILD ? { defaultAt: DEMO_START_MS } : {}),
  });
  if (!start) return null;
  for (const w of start.warnings) console.warn(`[time-machine] ${w}`);
  const machine = new TimeMachine({ at: start.at, speed: start.speed });
  return {
    source: machine,
    machine,
    start,
    activate: () => attachMachinePersistence(machine, { storage, writeUrl: !IS_DEMO_BUILD }),
  };
}
