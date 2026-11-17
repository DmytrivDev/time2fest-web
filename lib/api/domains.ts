/**
 * Хто обслуговує домен у збірці (`docs/backend/frontend-seam.md`, §2.3; FR-MIG-01). Без імпортів значень: файл читає й
 * `next.config.ts` (лише типи стираються).
 * - `sim` — усе з імітації;
 * - інтеграційна (`NEXT_PUBLIC_ENV=test` + `http`) — домен з адаптером `http` іде на сервер, без нього — на імітацію;
 * - робоча `http` — лише `http`; домену без адаптера немає (`ApiGuard` → «сервер недоступний»), імітації в пакеті немає.
 */
import type { ServiceName } from './services';

/** Домени, які інтерфейс уже бере через шов (E0–E5): без їхніх адаптерів сайт працювати не може. */
export const MIGRATED_DOMAINS: readonly ServiceName[] = ['notifications', 'rating', 'live', 'auth', 'profile', 'checkout', 'toasts', 'chat', 'passport', 'catalog'];

export type DomainServer = 'http' | 'sim';

export interface DomainRule {
  mode: 'sim' | 'http';
  /** Тестова чи демо-збірка (`NEXT_PUBLIC_ENV=test`). */
  testBuild: boolean;
  hasHttp: (name: ServiceName) => boolean;
  hasSim: (name: ServiceName) => boolean;
}

/** Єдине правило вибору адаптера; `null` — домену в цій збірці немає. */
export function domainServer(name: ServiceName, { mode, testBuild, hasHttp, hasSim }: DomainRule): DomainServer | null {
  if (mode === 'sim') return hasSim(name) ? 'sim' : null;
  if (hasHttp(name)) return 'http';
  // Інтеграційна збірка: імітація лише в тестовій; у робочій її фізично немає (`simEntry.disabled`).
  return testBuild && hasSim(name) ? 'sim' : null;
}

export interface DomainSplit {
  http: ServiceName[];
  sim: ServiceName[];
  missing: ServiceName[];
}

/** Розклад перенесених доменів за сервером (виводиться під час збирання інтеграційної збірки). */
export function splitDomains(rule: DomainRule, domains: readonly ServiceName[] = MIGRATED_DOMAINS): DomainSplit {
  const out: DomainSplit = { http: [], sim: [], missing: [] };
  for (const d of domains) {
    const by = domainServer(d, rule);
    (by ? out[by] : out.missing).push(d);
  }
  return out;
}

export function describeIntegrationSplit(split: DomainSplit): string {
  const list = (xs: ServiceName[]) => (xs.length ? xs.join(', ') : '—');
  return `[api] integration build: http = ${list(split.http)}; sim = ${list(split.sim)}`;
}
