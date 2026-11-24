/**
 * Власний облік операцій R2 процесу (SPEC-13b AC-39, AC-64, [П-9]), ring 3 — лічильники в пам'яті.
 *
 * Клас A — запис, список, multipart (створення, частини, завершення), видалення; клас B — читання й `head`
 * (як у AC-39). Рахується кожна відправлена спроба, вдала чи ні. Окремо — час останньої вдалої й невдалої
 * операції за префіксом `catalog | site | live | backups` (решта — `other`). Це нижня межа витрат Cloudflare:
 * читання краю сюди не потрапляють.
 *
 * Скидання в `spend-counters` (`cloudflare:<yyyy-mm>`, стовпці `classA`, `classB`) робить ticker витрат (S9):
 * `drain()` забирає ще не скинуту дельту; невдалий запис повертає її через `restore()`.
 */

export const R2_PREFIXES = ['catalog', 'site', 'live', 'backups'] as const;
export type R2Prefix = (typeof R2_PREFIXES)[number] | 'other';

export interface R2PrefixState {
  /** Epoch ms останньої вдалої операції або null. */
  lastOkAt: number | null;
  /** Epoch ms останньої невдалої операції або null. */
  lastFailedAt: number | null;
}

export interface R2OpCounts {
  classA: number;
  classB: number;
}

export interface R2MeterSnapshot extends R2OpCounts {
  /** Усього з початку процесу. */
  prefixes: Record<R2Prefix, R2PrefixState>;
}

export interface R2OpRecord extends R2OpCounts {
  prefix: R2Prefix;
  ok: boolean;
  /** Epoch ms завершення операції. */
  at: number;
}

export interface R2Meter {
  record(op: R2OpRecord): void;
  /** Підсумки з початку процесу й стан префіксів (копія). */
  snapshot(): R2MeterSnapshot;
  /** Забирає ще не скинуті лічильники й обнуляє їх. */
  drain(): R2OpCounts;
  /** Повертає дельту, яку не вдалося скинути. */
  restore(delta: R2OpCounts): void;
}

const emptyPrefixes = (): Record<R2Prefix, R2PrefixState> => ({
  catalog: { lastOkAt: null, lastFailedAt: null },
  site: { lastOkAt: null, lastFailedAt: null },
  live: { lastOkAt: null, lastFailedAt: null },
  backups: { lastOkAt: null, lastFailedAt: null },
  other: { lastOkAt: null, lastFailedAt: null },
});

export function createR2Meter(): R2Meter {
  const total: R2OpCounts = { classA: 0, classB: 0 };
  const unflushed: R2OpCounts = { classA: 0, classB: 0 };
  const prefixes = emptyPrefixes();
  return {
    record(op) {
      total.classA += op.classA;
      total.classB += op.classB;
      unflushed.classA += op.classA;
      unflushed.classB += op.classB;
      const state = prefixes[op.prefix];
      if (op.ok) state.lastOkAt = Math.max(state.lastOkAt ?? op.at, op.at);
      else state.lastFailedAt = Math.max(state.lastFailedAt ?? op.at, op.at);
    },
    snapshot() {
      const copy = emptyPrefixes();
      for (const p of Object.keys(prefixes) as R2Prefix[]) copy[p] = { ...prefixes[p] };
      return { classA: total.classA, classB: total.classB, prefixes: copy };
    },
    drain() {
      const out = { ...unflushed };
      unflushed.classA = 0;
      unflushed.classB = 0;
      return out;
    },
    restore(delta) {
      unflushed.classA += delta.classA;
      unflushed.classB += delta.classB;
    },
  };
}

/**
 * Префікс обліку для ключа: перший сегмент після префікса середовища (`<T2F_R2_PREFIX>catalog/…` → `catalog`).
 * Ключ поза префіксом середовища чи з іншим сегментом — `other`.
 */
export function r2PrefixOf(envPrefix: string): (key: string) => R2Prefix {
  return (key) => {
    if (!key.startsWith(envPrefix)) return 'other';
    const first = key.slice(envPrefix.length).split('/')[0] ?? '';
    return (R2_PREFIXES as readonly string[]).includes(first) ? (first as R2Prefix) : 'other';
  };
}
