/**
 * Реєстр витрат платних служб (SPEC-13b AC-60 … AC-65, [А18]): рядок на службу, відсортований за `key`.
 * Пороги 50 % (`log`) і 80 % (`page`) — раз на період на весь кластер; рядок `ai` лише показує витрати
 * SPEC-09 і не дублює його тривог (В2), `youtube` — квоту SPEC-12, `mail` — лічильник листів за добу UTC (SPEC-10 AC-46; свої тривоги `mail/*` піднімає поштовий сервіс).
 * Лише дані.
 */
import { assertRegistry } from '../platform/registry';

/** Період лічильника: місяць UTC; AI — ніч і місяць (як SPEC-09); YouTube — доба квоти. */
export type SpendPeriod = 'day' | 'month' | 'night+month';

export interface SpendRow {
  key: string;
  /** Назва українською. */
  title: string;
  /** Одиниця числа: `usd` або одиниці квоти. */
  unit: 'units' | 'usd';
  period: SpendPeriod;
  /**
   * Де стеля: поле глобалу `ops-settings` (AC-66) або налаштування хвилі-власника
   * (`moderation-settings` SPEC-09, конфіг ефіру SPEC-12).
   */
  ceiling: { from: 'env' | 'live-config' | 'moderation-settings' | 'ops-settings'; keys: readonly string[] };
  /** Звідки число — українською (показується в моніторингу). */
  source: string;
  /** Чи піднімає ця хвиля тривоги 50 % / 80 % (`spend/<key>-50|80`). */
  alarms: boolean;
  /** Позначка під числом (AC-64: «нижня межа»). */
  note?: string;
  ownerWave: string;
}

export const spendRegistry: readonly SpendRow[] = [
  {
    key: 'ai',
    title: 'AI (модерація й переклад)',
    unit: 'usd',
    period: 'night+month',
    ceiling: { from: 'moderation-settings', keys: ['nightCeilingUsd', 'monthCeilingUsd'] },
    source: 'Лічильник витрат AI SPEC-09 (ai_spend): ніч і місяць.',
    alarms: false,
    ownerWave: 'SPEC-09',
  },
  {
    key: 'cloudflare',
    title: 'Cloudflare R2',
    unit: 'usd',
    period: 'month',
    ceiling: { from: 'ops-settings', keys: ['cloudflareCeilingUsd'] },
    source: 'Запити класів A і B до R2 цього сервера й обсяг копій за ціною з налаштувань.',
    alarms: true,
    note: 'нижня межа: без читань краю',
    ownerWave: 'SPEC-13b',
  },
  {
    key: 'mail',
    title: 'Листи',
    unit: 'units',
    period: 'day',
    ceiling: { from: 'env', keys: ['T2F_MAIL_DAILY_CEILING'] },
    source: 'Лічильник листів за добу UTC основного постачальника; без поштового сервісу — немає провайдера.',
    alarms: false,
    ownerWave: 'SPEC-10',
  },
  {
    key: 'server',
    title: 'Сервер',
    unit: 'usd',
    period: 'month',
    ceiling: { from: 'ops-settings', keys: ['serverCeilingUsd'] },
    source: 'Базова ціна вузла пропорційно дням місяця плюс записані години нічного розміру.',
    alarms: true,
    ownerWave: 'SPEC-13b',
  },
  {
    key: 'youtube',
    title: 'Квота YouTube',
    unit: 'units',
    period: 'day',
    ceiling: { from: 'live-config', keys: ['quota.queries.perDay'] },
    source: 'Лічильник квоти SPEC-12 за добу.',
    alarms: false,
    ownerWave: 'SPEC-12',
  },
];

const CYRILLIC = /[Ѐ-ӿ]/;

/** Static check (AC-60): sorted, one row per key, a title, a Ukrainian source, at least one ceiling key. */
export function assertSpendRegistry(rows: readonly SpendRow[]): void {
  assertRegistry('spend', rows, (r) => r.key);
  for (const r of rows) {
    if (r.title.trim() === '') throw new Error(`registry spend: row ${r.key} title empty`);
    if (!CYRILLIC.test(r.source)) throw new Error(`registry spend: row ${r.key} source empty or not Ukrainian`);
    if (r.ceiling.keys.length === 0) throw new Error(`registry spend: row ${r.key} has no ceiling key`);
    if (r.ownerWave.trim() === '') throw new Error(`registry spend: row ${r.key} ownerWave empty`);
  }
}

assertSpendRegistry(spendRegistry);
