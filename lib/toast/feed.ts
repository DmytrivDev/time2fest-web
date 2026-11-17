/**
 * Тости світу — чисті правила смуги тостів, чату й привітання опівночі (рішення власника 2026-11-12, дошки
 * `Desk-Toast-New`, `Phone-Toast-New` v2):
 * - тост $5 і $10 закріплено під трансляцією до найближчої півночі поясу ПІСЛЯ того, як його сказали; після останньої
 *   півночі наступної немає — закріплений до кінця свята (остання північ + `CELEBRATION_TAIL`, рішення власника 2026-11-14);
 * - смуга показує спершу закріплені (дорожчі першими, далі новіші), потім найновіші незакріплені; по одному, по колу;
 * - у привітанні опівночі — ніки тих, хто сказав тост на $10 до цієї півночі (після попередньої).
 * Тости загальні — без прив’язки до міста: однакові на головній, сторінці країни й у кімнаті.
 */
import type { Ms } from '@/lib/data/types';
import { pinnedUntilAt } from '@time2fest/rules/time';
import { tierGreets, tierPins, type ToastTier } from './tiers';

export interface ToastRecord {
  id: string;
  /** Автор у чаті (імітовані — автор сценарію чату; свій — id гостя). */
  authorId?: string;
  nick: string;
  flagCode: string;
  text: string;
  tier: ToastTier;
  createdAt: Ms;
  /** Свій тост (цей пристрій). */
  mine?: boolean;
  /** Біля ніку — позначка пасу (власник пасу; тост за $10 дарує пас). */
  pass?: boolean;
  /**
   * Країни (ISO), чиї чати сторінка показувала, коли тост сказано: тост іде в «Світ» і в чат кожної з цих країн — один тост,
   * кілька кімнат (рішення власника 2026-11-15). Порожньо — лише «Світ».
   */
  countries?: readonly string[];
}

/** Скільки найновіших незакріплених тостів іде в смугу (і в її ротацію). */
export const LATEST_LIMIT = 8;
/** Скільки найновіших показує розгорнутий список у «Щойно». */
export const LATEST_IN_LIST = 4;
/** Скільки ніків-чипів у привітанні опівночі; решта — «і ще N». */
export const GREETING_CHIPS = 8;
/** Тост у смузі змінюється кожні ≈6 с. */
export const ROTATE_MS = 6_000;
/** Згорнутий чат на телефоні показує новий тост ≈10 с. */
export const DOCK_TOAST_MS = 10_000;

/**
 * До якої миті тост закріплено під трансляцією (`null` — не закріплюється: $2 чи свято вже скінчилось). Тост після
 * останньої півночі закріплюється до кінця свята (`midnights` — за зростанням).
 */
export function pinnedUntil(t: Pick<ToastRecord, 'tier' | 'createdAt'>, midnights: readonly Ms[]): Ms | null {
  return tierPins(t.tier) ? pinnedUntilAt(t.createdAt, midnights) : null;
}

export interface StripItem {
  toast: ToastRecord;
  /** Закріплено до цієї миті (лише закріплені). */
  until?: Ms;
}

export interface StripView {
  pinned: StripItem[];
  latest: StripItem[];
  /** Порядок показу по одному: закріплені, потім найновіші. */
  rotation: StripItem[];
  /** Тостів за свято (уже сказаних). */
  total: number;
  /** Країн (прапорів) серед авторів. */
  countries: number;
}

/** Що показує смуга в момент `now`: лише вже сказані тости. */
export function stripView(toasts: readonly ToastRecord[], now: Ms, midnights: readonly Ms[], latestLimit = LATEST_LIMIT): StripView {
  const said = toasts.filter((t) => t.createdAt <= now);
  const pinned: StripItem[] = [];
  const rest: StripItem[] = [];
  for (const t of said) {
    const until = pinnedUntil(t, midnights);
    if (until !== null && now < until) pinned.push({ toast: t, until });
    else rest.push({ toast: t });
  }
  pinned.sort((a, b) => b.toast.tier - a.toast.tier || b.toast.createdAt - a.toast.createdAt || cmpId(a.toast, b.toast));
  rest.sort((a, b) => b.toast.createdAt - a.toast.createdAt || cmpId(a.toast, b.toast));
  const latest = rest.slice(0, latestLimit);
  return {
    pinned,
    latest,
    rotation: [...pinned, ...latest],
    total: said.length,
    countries: new Set(said.map((t) => t.flagCode)).size,
  };
}

function cmpId(a: ToastRecord, b: ToastRecord): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Позиція в ротації після зміни списку: той самий тост лишається на екрані (новий тост не «перескакує» показаний);
 * показаного вже немає — та сама позиція, обрізана до довжини.
 */
export function keepIndex(rotation: readonly StripItem[], shownId: string | null, index: number): number {
  if (!rotation.length) return 0;
  if (shownId) {
    const i = rotation.findIndex((r) => r.toast.id === shownId);
    if (i >= 0) return i;
  }
  return Math.min(Math.max(0, index), rotation.length - 1);
}

/** Наступний (`step` = 1) чи попередній (−1) тост по колу. */
export function stepIndex(index: number, length: number, step: 1 | -1): number {
  if (length <= 0) return 0;
  return (((index + step) % length) + length) % length;
}

export interface Toaster {
  nick: string;
  flagCode: string;
}

/**
 * Хто піднімає тост цієї півночі: тости на $10, сказані після попередньої півночі поясу й до цієї (найближчої після
 * оплати). Порядок — хто раніше; одна людина (нік + прапор) — один чип.
 */
export function greetingToasters(toasts: readonly ToastRecord[], midnight: Ms, prevMidnight: Ms | null): Toaster[] {
  const seen = new Set<string>();
  const out: Toaster[] = [];
  const list = toasts
    .filter((t) => tierGreets(t.tier) && t.createdAt < midnight && (prevMidnight === null || t.createdAt >= prevMidnight))
    .sort((a, b) => a.createdAt - b.createdAt || cmpId(a, b));
  for (const t of list) {
    const key = `${t.nick.toLowerCase()}|${t.flagCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ nick: t.nick, flagCode: t.flagCode });
  }
  return out;
}

/** Склад рядків привітання: перші три країни + «й ще N», до 8 чипів + «і ще N» (дошка, «Північ · привітання»). */
export function greetingParts<T>(countries: readonly T[], toasters: readonly Toaster[]): {
  countries: T[];
  moreCountries: number;
  chips: Toaster[];
  moreToasters: number;
} {
  const shownCountries = countries.slice(0, 3);
  const chips = toasters.slice(0, GREETING_CHIPS);
  return {
    countries: shownCountries,
    moreCountries: Math.max(0, countries.length - shownCountries.length),
    chips,
    moreToasters: Math.max(0, toasters.length - chips.length),
  };
}
