/**
 * Ops wiring of the composition root (SPEC-13b; architecture A-4: moved out of `container.ts`, no behaviour
 * change). Builds the ops stores and the Telegram sink, the backup job's dependencies, the spend counters job
 * and the ops runner's sources. `container.ts` calls these with its own accessors (`payloadOf`,
 * `catalogCopyDepsOf`), so this module never imports the container.
 */
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type { Payload } from 'payload';
import {
  createPayloadBackupFacts,
  createPayloadBackupRuns,
  createPayloadBackupStorage,
  createPayloadLogAlarms,
  createPayloadOpsJournal,
  createPayloadOpsSpendSettings,
  createPayloadOutbox,
  createPayloadSpendCounters,
  createPgOpsLease,
} from './adapters/payloadOps';
import { createPayloadJournal } from './adapters/payloadJournal';
import { createPgAiSpend } from './adapters/pgAiSpend';
import { createPgDumpRunner } from './adapters/pgDump';
import { selectTelegramSink } from './adapters/telegram';
import type { CatalogCopyDeps } from './catalog/copy';
import { realClock } from './clock';
import { counterOf, quotaDay } from './domain/live/quota';
import { MICROS_PER_USD, periodsAt } from './domain/moderation/spend';
import { alarmStoreOf, catalogStoreOf } from './endpoints/deps';
import type { AppEnv, Deps } from './endpoints/types';
import { createBackupJob, type BackupDeps } from './ops/backup';
import { keyIdOf, parseBackupKey } from './ops/backupFormat';
import type { OpsRunnerDeps, OpsWiring } from './ops/runner';
import { createSpendJob, type SpendJob } from './ops/spend';
import { createMailPlanJob } from './ops/mailPlan';
import type { Logger } from './ports';
import { isRevertible } from './registries/revertHandlers';

/**
 * The ops stores and the Telegram sink (SPEC-13b W14): sink chosen by class (AC-13), `null` when not configured
 * (AC-14: the status is kept for the overview; the alarm `ops/telegram-not-configured` is raised once by
 * `startOpsTicker`, never by building deps).
 */
export function createOpsWiring(env: AppEnv, log: Logger, payload: () => Promise<Payload>): OpsWiring {
  const selected = selectTelegramSink(env.class, env.vars, { log });
  const journal = createPayloadJournal(isRevertible);
  return {
    telegram:
      selected.sink !== null
        ? { status: 'configured', sink: selected.sink, chatId: selected.chatId }
        : { status: 'not-configured', sink: null, chatId: null, ...(selected.missing ? { missing: selected.missing } : {}) },
    outbox: createPayloadOutbox({ payload, journal }),
    logAlarms: createPayloadLogAlarms(payload, realClock),
    lease: createPgOpsLease({ payload, journal, holderId: `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}` }),
    clock: realClock,
    cls: env.class,
  };
}

/**
 * The backup job's dependencies (SPEC-13b W25, AC-48): the key from `T2F_BACKUP_KEY` (absent → not configured),
 * the metered store of the environment's own bucket and prefix (`catalogCopyDepsOf`: the env guards of
 * `platform/env.ts` already refused a production bucket outside production), the local `pg_dump` (or the test
 * seam `backupTuning.dump`), `backup-runs`, the journal and the facts of the manifest. Nothing is read here.
 */
export function buildBackupDeps(deps: Deps, payload: () => Promise<Payload>, copy: CatalogCopyDeps | undefined): BackupDeps {
  const v = deps.env.vars;
  const rawKey = typeof v.T2F_BACKUP_KEY === 'string' ? v.T2F_BACKUP_KEY : '';
  const key = rawKey ? parseBackupKey(rawKey) : null;
  const facts = createPayloadBackupFacts(payload);
  const tuning = deps.backupTuning;
  return {
    config: {
      key,
      keyId: key ? keyIdOf(key) : null,
      store: copy?.objects ?? null,
      prefix: copy?.prefix ?? '',
      endpoint: typeof v.T2F_R2_ENDPOINT === 'string' ? v.T2F_R2_ENDPOINT : null,
      dump: tuning?.dump ?? createPgDumpRunner({ databaseUri: String(v.DATABASE_URI ?? ''), serverVersion: () => facts.serverVersion() }),
      commit: typeof v.T2F_COMMIT === 'string' ? v.T2F_COMMIT : null,
      ...(tuning?.partBytes ? { partBytes: tuning.partBytes } : {}),
    },
    cls: deps.env.class,
    alarm: deps.alarm,
    log: deps.log,
    journal: createPayloadOpsJournal({ payload, journal: createPayloadJournal(isRevertible), collection: 'backup-runs' }),
    runs: createPayloadBackupRuns(payload),
    facts,
    clock: realClock,
  };
}

/**
 * The spend counters job of this process (SPEC-13b S9): `ai` and `youtube` read the SPEC-09 / SPEC-12 sources, `server` and
 * `cloudflare` the `spend-counters` store and `ops-settings`. The runner ticks it; the monitoring overview and the `ops`
 * commands (`recordServerHours`) use the same instance shape.
 */
export function buildSpendJob(deps: Deps, ops: OpsWiring, payload: () => Promise<Payload>): SpendJob {
  return createSpendJob({
    counters: createPayloadSpendCounters(payload),
    settings: createPayloadOpsSpendSettings(payload),
    lease: ops.lease,
    alarm: deps.alarm,
    ...(deps.r2Meter ? { meter: deps.r2Meter } : {}),
    ai: async (now) => {
      const m = deps.moderation;
      if (!m) return null;
      const p = periodsAt(now);
      const keys = p.night ? [p.night, p.month] : [p.month];
      const [totals, settings] = await Promise.all([createPgAiSpend(payload).read(keys), m.settings.read()]);
      // The bucket nearest to its ceiling (SPEC-09 judges night and month separately).
      const rows = keys.map((k) => ({ usd: (totals.get(k) ?? 0) / MICROS_PER_USD, ceilingUsd: k.startsWith('night:') ? settings.nightCeilingUsd : settings.monthCeilingUsd }));
      return rows.reduce((a, b) => (b.usd / (b.ceilingUsd || 1) > a.usd / (a.ceilingUsd || 1) ? b : a));
    },
    youtube: async (now) => {
      const live = deps.live;
      if (!live) return null;
      const state = await live.quota.read(quotaDay(now, live.cfg.dayTimeZone));
      return { used: counterOf(state, 'queries', now, live.cfg).used, limit: live.cfg.buckets.queries.perDay };
    },
    backupStorageBytes: () => createPayloadBackupStorage(payload).bytes(),
    mail: async () => {
      const counts = await deps.mail?.countsToday?.();
      return counts ? { sentToday: counts.primary.sent, ceiling: counts.primary.ceiling, fallbackSent: counts.fallback.sent } : null;
    },
  });
}

/**
 * What the ops runner reads beyond the ops stores (SPEC-13b W18): catalog zones for the celebration window
 * (AC-18, AC-19), open `page` alarms, the last successful backup (`backup-runs`, S8), spend over 50 % (S9) and the journal of skipped slots (AC-21); the backup job (S8). All lazy: nothing is read while building deps.
 */
export function opsRunnerDepsOf(deps: Deps, ops: OpsWiring, payload: () => Promise<Payload>, backupDeps: BackupDeps): OpsRunnerDeps {
  const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
  const spend = buildSpendJob(deps, ops, payload);
  return {
    ops,
    alarm: deps.alarm,
    log: deps.log,
    backup: createBackupJob({ ...backupDeps, lease: ops.lease }),
    spend,
    mailPlan: createMailPlanJob({ lease: ops.lease, store: deps.redis, alarm: deps.alarm, plan: deps.env.vars.T2F_MAIL_PLAN === 'pro' ? 'pro' : 'free' }),
    sources: {
      async zones() {
        const stored = await catalogStoreOf(deps).read();
        if (!stored.season) return null;
        return { zones: stored.zones.map((z) => ({ midnightMs: Date.parse(str(z.midnightUtc)) })).filter((z) => Number.isFinite(z.midnightMs)) };
      },
      openPageCount: async () => (await alarmStoreOf(deps).listOpenPage()).length,
      lastBackupAt: async () => (await backupDeps.runs.latest()).lastOk?.snapshotAt ?? null,
      spendOver50: (now) => spend.over50(now),
      journal: createPayloadOpsJournal({ payload, journal: createPayloadJournal(isRevertible) }),
    },
  };
}
