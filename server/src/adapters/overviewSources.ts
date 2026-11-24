/**
 * Постачальники огляду моніторингу з `Deps` (SPEC-13b AC-31, AC-34), ring 4. Кожен читає тим самим доступом,
 * що й зріз свого домену (`festivalState`, `liveView`, `readSnapshot`, `moderation.spend`), тож метрики збігаються
 * зі зрізами. Контейнер завантажується ліниво (він імпортує реєстри, що сягають сюди — статичний імпорт дав би цикл).
 */
import { sql } from '@payloadcms/db-postgres';
import type { Payload } from 'payload';
import { alarmStoreOf, catalogStoreOf, liveOf, moderationOf, siteOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import { liveView } from '../live/actions';
import type { OverviewSources } from '../ops/overview';
import { liveActionsOf } from '../registries/revertHandlers';
import { festivalState } from '../scheduler/festival';
import { readSnapshot } from '../site/snapshot';
import { festivalDepsOf } from './processDeps';
import { createPayloadBackupRuns } from './payloadOps';

const PERCENT = 100;
const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const pct = (usd: number, ceiling: number) => (ceiling > 0 ? Math.round((usd / ceiling) * 1000) / 10 : 0);
const ms = (v: unknown): number | null => {
  const t = typeof v === 'string' || v instanceof Date ? new Date(v).getTime() : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The sources of the overview over the process deps (the endpoint and the `ops status` command use the same). */
export async function overviewSourcesOf(deps: Deps): Promise<OverviewSources> {
  const { payloadOf, spendJobOf } = await import('../container');
  const payload: () => Promise<Payload> = payloadOf(deps);
  // One read of the festival state per overview: the `time` and `scheduler` blocks both come from it.
  let festival: ReturnType<typeof festivalState> | undefined;
  const festivalOnce = () => {
    festival ??= (async () => {
      await deps.sharedClock?.refresh().catch(() => undefined);
      return festivalState(festivalDepsOf(deps, payload));
    })();
    return festival;
  };
  const clock = deps.ops?.clock;

  return {
    now: () => (clock ? clock.now() : deps.clock.now()),
    env: deps.env.class,
    openPageAlarms: () => alarmStoreOf(deps).listOpenPage(),
    logAlarms: async (since) => {
      if (!deps.ops) throw new Error('ops not wired');
      return deps.ops.logAlarms.listLog(since);
    },
    async time() {
      const v = await festivalOnce();
      if (v.errors?.includes('edge') || v.errors?.includes('clock')) throw new Error('time unavailable');
      return { edgeSkewMs: v.edgeSkewMs, virtual: v.clock.virtual, speed: v.clock.speed };
    },
    async scheduler() {
      const v = await festivalOnce();
      if (v.errors?.includes('scheduler')) throw new Error('scheduler unavailable');
      const { holder, epoch, delayMs, renewedAgeMs, missed24h } = v.scheduler;
      return { holder, epoch, lagMs: delayMs, renewedAgeMs, missed24h };
    },
    async catalog() {
      const stored = await catalogStoreOf(deps).read();
      const r2 = deps.r2Meter?.snapshot().prefixes.catalog;
      return {
        seasonKey: stored.season?.key ?? null,
        generatedAt: stored.season?.generatedAt ?? null,
        r2LastOkAt: r2?.lastOkAt ?? null,
        r2LastFailedAt: r2?.lastFailedAt ?? null,
      };
    },
    async site() {
      const site = siteOf(deps);
      // Sequential: the reads may share one database session.
      const read = await readSnapshot(site.snapshot);
      const record = await site.store.read();
      if (!read.ok) throw new Error('site unavailable');
      const switches: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(read.state.switches)) if (typeof v === 'boolean') switches[k] = v;
      return { version: read.state.version, outage: read.state.outage === 'technical', paymentsPause: record.paymentsPause ?? null, switches };
    },
    async live() {
      const live = liveOf(deps);
      const view = await liveView(liveActionsOf(deps), live.quota);
      const sources = view.slots.flatMap((s) => s.events.flatMap((e) => e.sources));
      return {
        version: view.version,
        quota: view.quota.map((q) => ({ bucket: q.bucket, used: q.used, perDay: q.perDay, percent: Math.floor(q.ratio * PERCENT) })),
        sources: { total: sources.length, dead: sources.filter((s) => s.dead).length, hidden: sources.filter((s) => s.hidden).length },
      };
    },
    async moderation() {
      const m = moderationOf(deps);
      const totals = m.spend.totals();
      const bucket = (b: { usd: number; ceilingUsd: number } | null) => (b === null ? null : { usd: b.usd, ceilingUsd: b.ceilingUsd, percent: pct(b.usd, b.ceilingUsd) });
      return {
        tasks: (['moderation', 'translation'] as const).map((task) => {
          const s = m.layer.state(task);
          return { task, state: s.state, reason: s.reason ?? null };
        }),
        providers: m.layer.stats().map((p) => ({ provider: p.provider, task: p.task, status: p.status })),
        night: bucket(totals.night),
        month: bucket(totals.month),
      };
    },
    async backups() {
      const runs = createPayloadBackupRuns(payload);
      const { last, lastOk } = await runs.latest();
      // `restore-runs` is written by `ops restore-record` (S11); no rows → «ще не заміряно».
      const restored = await (await payload()).find({ collection: 'restore-runs', sort: '-at', limit: 1, depth: 0, overrideAccess: true, context: CONTEXT });
      const r = restored.docs[0] as unknown as Record<string, unknown> | undefined;
      const rAt = r ? ms(r.at) : null;
      return {
        last: last ? { at: last.snapshotAt, result: last.result, kind: last.kind, stage: last.stage ?? null, size: last.size ?? null } : null,
        lastOk: lastOk ? { at: lastOk.snapshotAt, size: lastOk.size ?? null } : null,
        lastRestore:
          r && rAt !== null
            ? {
                at: rAt,
                result: r.result === 'ok' ? 'ok' : 'failed',
                durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
                lossWindowMs: typeof r.lossWindowMs === 'number' ? r.lossWindowMs : null,
              }
            : null,
      };
    },
    async telegram() {
      const status = deps.ops?.telegram.status ?? 'not-configured';
      const db = ((await payload()).db as unknown as { drizzle: Exec }).drizzle;
      const { rows } = await db.execute(sql`SELECT max("delivered_at") AS "at" FROM "alarm_deliveries" WHERE "kind" = 'heartbeat' AND "status" = 'delivered'`);
      const stored = await catalogStoreOf(deps).read();
      const zones = stored.season
        ? { zones: stored.zones.map((z) => ({ midnightMs: Date.parse(String(z.midnightUtc ?? '')) })).filter((z) => Number.isFinite(z.midnightMs)) }
        : null;
      return { status, lastDeliveredAt: ms(rows[0]?.at), zones };
    },
    async spend(now) {
      if (!deps.ops) throw new Error('ops not wired');
      return spendJobOf(deps, deps.ops, payload).rows(now);
    },
  };
}
