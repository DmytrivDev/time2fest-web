/**
 * Зберігання копій бази (SPEC-13b AC-46), ring 1: чиста функція над списком об'єктів. Видаляються лише пари
 * `<префікс копій><yyyymmddThhmmssZ>.dump.enc` + `.manifest.json` точно під префіксом копій; будь-який інший
 * об'єкт (каталог, сайт, ефір, сирота без пари) не чіпається ніколи. Лишаються 30 найновіших щоденних (знімок
 * о 03 год UTC) і 72 найновіші годинні; найновіша повна пара не видаляється за жодних умов; пара з іменем
 * пізніше за `now` (розбіжність годинників) — теж.
 */

export const KEEP_DAILY = 30;
export const KEEP_HOURLY = 72;
/** Година UTC щоденного слоту (AC-40). */
const DAILY_HOUR_UTC = 3;

/** Пара об'єктів однієї копії. */
export interface BackupPair {
  /** `yyyymmddThhmmssZ`. */
  stamp: string;
  /** Epoch ms мітки імені. */
  at: number;
  dumpKey: string;
  manifestKey: string;
  kind: 'daily' | 'hourly';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Мітка часу імені копії: `yyyymmddThhmmssZ` (UTC). */
export function backupStamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function stampMs(stamp: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  // Відкидає неіснуючі дати (20261332…), щоб «нормалізована» мітка не стала чужою.
  return backupStamp(ms) === stamp ? ms : Number.NaN;
}

/** Повні пари під `backupsPrefix` (напр. `t2f/test/backups/db/`), найновіші першими. */
export function backupPairs(keys: readonly string[], backupsPrefix: string): BackupPair[] {
  const re = new RegExp(`^${escapeRe(backupsPrefix)}(\\d{8}T\\d{6}Z)\\.(dump\\.enc|manifest\\.json)$`);
  const seen = new Map<string, { dump?: string; manifest?: string }>();
  for (const key of keys) {
    const m = re.exec(key);
    if (!m) continue;
    const stamp = m[1]!;
    const entry = seen.get(stamp) ?? {};
    if (m[2] === 'dump.enc') entry.dump = key;
    else entry.manifest = key;
    seen.set(stamp, entry);
  }
  const pairs: BackupPair[] = [];
  for (const [stamp, e] of seen) {
    const at = stampMs(stamp);
    if (!e.dump || !e.manifest || !Number.isFinite(at)) continue;
    pairs.push({ stamp, at, dumpKey: e.dump, manifestKey: e.manifest, kind: new Date(at).getUTCHours() === DAILY_HOUR_UTC ? 'daily' : 'hourly' });
  }
  return pairs.sort((a, b) => b.at - a.at);
}

/** Пари до видалення (AC-46): поза 30 найновішими щоденними й 72 найновішими годинними. */
export function retentionPlan(keys: readonly string[], backupsPrefix: string, now: number): BackupPair[] {
  const pairs = backupPairs(keys, backupsPrefix);
  const newest = pairs[0];
  const kept = { daily: 0, hourly: 0 };
  const limit = { daily: KEEP_DAILY, hourly: KEEP_HOURLY };
  const doomed: BackupPair[] = [];
  for (const p of pairs) {
    if (p.at > now) continue;
    // The newest pair counts toward its kind's quota and is never deleted.
    if (kept[p.kind] < limit[p.kind] || p === newest) kept[p.kind] += 1;
    else doomed.push(p);
  }
  return doomed;
}
