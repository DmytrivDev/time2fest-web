/**
 * Огляд моніторингу (SPEC-13b AC-31 … AC-36), ring 3: кожен блок — власний постачальник у `try` (зразок `scheduler/festival.ts`); збій одного дає `errors:[блок]` і не ламає решту. Постачальники приходять
 * портами (`OverviewSources`, збирає `adapters/overviewSources.ts`), тож тут немає ні Payload, ні `Date.now()`.
 * Метрики, яких у коді ще немає, — рядки блоку `pending` з реєстру `registries/ops.ts` («немає даних»), числа не вигадуються.
 */
import type { AlarmRecord, LogAlarmRecord } from '../alarms/ports';
import { celebrationWindow } from '../domain/ops/schedule';
import { findKind, kindOf, opsRegistry } from '../registries/ops';
import {
  BLOCK_KEYS,
  HEARTBEAT_RED_MS,
  OVERVIEW_MAX_ALARMS,
  OVERVIEW_MAX_BYTES,
  SCHEDULER_LAG_THRESHOLD_MS,
  TIME_THRESHOLD_MS,
  type AlarmsBlock,
  type LogAlarmsBlock,
  type Overview,
  type OverviewBlockKey,
  type OverviewBlocks,
  type SpendRow,
} from './overviewSchema';

const DAY_MS = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null | undefined): string | null => (typeof ms === 'number' ? iso(ms) : null);

type Block<K extends OverviewBlockKey> = NonNullable<OverviewBlocks[K]>;

/** Дані, що вже є в зрізах своїх доменів; кожне поле — один постачальник. */
export interface OverviewSources {
  /** Стінний годинник (epoch ms). */
  now(): number;
  env: string;
  openPageAlarms(): Promise<AlarmRecord[]>;
  logAlarms(sinceMs: number): Promise<LogAlarmRecord[]>;
  /** Розбіжність часу краю й сервера та годинник (зріз «Стан свята»). */
  time(): Promise<{ edgeSkewMs: number | null; virtual: boolean; speed: number }>;
  /** Затримка й оренда планувальника (зріз «Стан свята»). */
  scheduler(): Promise<{ holder: string | null; epoch: number; lagMs: number | null; renewedAgeMs: number | null; missed24h: number }>;
  catalog(): Promise<{ seasonKey: string | null; generatedAt: string | null; r2LastOkAt: number | null; r2LastFailedAt: number | null }>;
  site(): Promise<Block<'site'>>;
  live(): Promise<Block<'live'>>;
  moderation(): Promise<Block<'moderation'>>;
  backups(): Promise<{
    last: { at: number; result: 'ok' | 'failed'; kind: string; stage: string | null; size: number | null } | null;
    lastOk: { at: number; size: number | null } | null;
    lastRestore: { at: number; result: 'ok' | 'failed'; durationMs: number | null; lossWindowMs: number | null } | null;
  }>;
  telegram(): Promise<TelegramInput>;
  spend(now: number): Promise<SpendRow[]>;
}

export interface TelegramInput {
  status: 'configured' | 'not-configured';
  lastDeliveredAt: number | null;
  zones: { zones: readonly { midnightMs: number }[] } | null;
}

const domainOf = (a: { source: string; code: string }) => findKind(a.source, a.code);

function alarmsBlock(open: readonly AlarmRecord[], limit: number): AlarmsBlock {
  const newest = [...open].sort((a, b) => b.raisedAt - a.raisedAt);
  return {
    total: newest.length,
    items: newest.slice(0, limit).map((a) => {
      const hit = domainOf(a);
      return {
        id: a.id,
        source: a.source,
        code: a.code,
        kind: kindOf(a),
        domain: hit?.domain.domain ?? null,
        domainTitle: hit?.domain.title ?? null,
        raisedAt: iso(a.raisedAt),
        meaning: hit?.alarm.meaning ?? null,
        action: hit?.alarm.action ?? null,
      };
    }),
  };
}

/** `log`-тривоги за 24 год, згруповані за доменом і видом (AC-33). */
export function groupLogAlarms(records: readonly LogAlarmRecord[], sinceMs: number): LogAlarmsBlock {
  const groups = new Map<string, { domain: string | null; domainTitle: string | null; kind: string; count: number; last: number }>();
  for (const r of records) {
    const hit = domainOf(r);
    const kind = kindOf(r);
    const g = groups.get(kind) ?? { domain: hit?.domain.domain ?? null, domainTitle: hit?.domain.title ?? null, kind, count: 0, last: 0 };
    g.count += 1;
    g.last = Math.max(g.last, r.raisedAt);
    groups.set(kind, g);
  }
  const sorted = [...groups.values()].sort((a, b) => (a.domain ?? '~').localeCompare(b.domain ?? '~') || a.kind.localeCompare(b.kind));
  return {
    since: iso(sinceMs),
    total: records.length,
    groups: sorted.map((g) => ({ domain: g.domain, domainTitle: g.domainTitle, kind: g.kind, count: g.count, lastAt: iso(g.last) })),
  };
}

/** Блок «Telegram»: червоний, коли у вікні свята понад 70 хв без доставленого контрольного повідомлення (AC-23). */
export function telegramBlock(input: TelegramInput, now: number): Block<'telegram'> {
  const window = celebrationWindow(input.zones, now);
  const inWindow = now >= window.start && now <= window.end;
  const since = inWindow ? Math.max(input.lastDeliveredAt ?? window.start, window.start) : null;
  const silentForMs = since === null ? null : Math.max(0, now - since);
  return {
    status: input.status,
    lastDeliveredAt: isoOrNull(input.lastDeliveredAt),
    inWindow,
    silentForMs,
    red: input.status === 'configured' && silentForMs !== null && silentForMs > HEARTBEAT_RED_MS,
  };
}

/** Зарезервовані рядки реєстру: метрики з хвилею-власником, без чисел (AC-35). */
export function pendingBlock(): Block<'pending'> {
  return {
    rows: opsRegistry.flatMap((d) =>
      d.metrics
        .filter((m) => m.pendingNote !== undefined)
        .map((m) => ({ domain: d.domain, domainTitle: d.title, metricKey: m.key, title: m.title, ownerWave: m.pendingNote ?? d.ownerWave })),
    ),
  };
}

/** Огляд цілком: блок за блоком, збій блоку → `null` і запис у `errors`. Відповідь не більша за 64 КБ (AC-36). */
export async function buildOverview(s: OverviewSources): Promise<Overview> {
  const now = s.now();
  const sinceLog = now - DAY_MS;
  const providers: { [K in OverviewBlockKey]: () => Promise<Block<K>> } = {
    alarms: async () => alarmsBlock(await s.openPageAlarms(), OVERVIEW_MAX_ALARMS),
    logAlarms: async () => groupLogAlarms(await s.logAlarms(sinceLog), sinceLog),
    time: async () => {
      const t = await s.time();
      return { edgeSkewMs: t.edgeSkewMs, thresholdMs: TIME_THRESHOLD_MS, over: t.edgeSkewMs === null ? null : Math.abs(t.edgeSkewMs) > TIME_THRESHOLD_MS, virtual: t.virtual, speed: t.speed };
    },
    scheduler: async () => {
      const x = await s.scheduler();
      return { ...x, lagThresholdMs: SCHEDULER_LAG_THRESHOLD_MS, over: x.lagMs === null ? null : x.lagMs > SCHEDULER_LAG_THRESHOLD_MS };
    },
    catalog: async () => {
      const c = await s.catalog();
      return { seasonKey: c.seasonKey, generatedAt: c.generatedAt, r2LastOkAt: isoOrNull(c.r2LastOkAt), r2LastFailedAt: isoOrNull(c.r2LastFailedAt) };
    },
    site: () => s.site(),
    live: () => s.live(),
    moderation: () => s.moderation(),
    backups: async () => {
      const b = await s.backups();
      return {
        last: b.last ? { at: iso(b.last.at), result: b.last.result, kind: b.last.kind, stage: b.last.stage, size: b.last.size } : null,
        lastOk: b.lastOk ? { at: iso(b.lastOk.at), size: b.lastOk.size, ageMs: Math.max(0, now - b.lastOk.at) } : null,
        lastRestore: b.lastRestore ? { at: iso(b.lastRestore.at), result: b.lastRestore.result, durationMs: b.lastRestore.durationMs, lossWindowMs: b.lastRestore.lossWindowMs } : null,
      };
    },
    telegram: async () => telegramBlock(await s.telegram(), now),
    spend: async () => ({ rows: await s.spend(now) }),
    pending: async () => pendingBlock(),
  };
  // Послідовно: читання можуть ділити одну сесію бази (pg не терпить паралельних запитів на клієнті); збій одного не чіпає інших.
  const blocks: Record<string, unknown> = {};
  const errors: OverviewBlockKey[] = [];
  for (const key of BLOCK_KEYS) {
    try {
      blocks[key] = await (providers[key] as () => Promise<unknown>)();
    } catch {
      blocks[key] = null;
      errors.push(key);
    }
  }
  return trimOverview({ at: iso(now), env: s.env, blocks: blocks as OverviewBlocks, errors });
}

/** Скорочує списки, поки відповідь більша за 64 КБ (AC-36): тривоги й групи `log`. */
export function trimOverview(o: Overview, maxBytes: number = OVERVIEW_MAX_BYTES): Overview {
  const size = (x: Overview) => Buffer.byteLength(JSON.stringify(x), 'utf8');
  let out = o;
  for (const keep of [50, 25, 10, 5, 0]) {
    if (size(out) <= maxBytes) return out;
    const { alarms, logAlarms } = out.blocks;
    out = {
      ...out,
      blocks: {
        ...out.blocks,
        alarms: alarms ? { ...alarms, items: alarms.items.slice(0, keep) } : alarms,
        logAlarms: logAlarms ? { ...logAlarms, groups: logAlarms.groups.slice(0, keep) } : logAlarms,
      },
    };
  }
  return out;
}
