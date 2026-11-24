/**
 * Схема огляду моніторингу (SPEC-13b AC-31, AC-36), ring 2: відповідь `GET /cms-api/ops/overview` і
 * JSON команди `ops status` проходять одну й ту саму перевірку. Значень секретів тут немає за побудовою:
 * лише лічильники, стани, час і коди тривог.
 */
import { z } from 'zod';

/** Порогова розбіжність часу краю й сервера, мс (SPEC-07). */
export const TIME_THRESHOLD_MS = 250;
/** Поріг затримки планувальника, мс (SPEC-07). */
export const SCHEDULER_LAG_THRESHOLD_MS = 2_000;
/** Скільки хвилин тиші контрольного повідомлення у вікні свята робить блок червоним (AC-23). */
export const HEARTBEAT_RED_MS = 70 * 60_000;
/** Найбільша відповідь, байт (AC-36). */
export const OVERVIEW_MAX_BYTES = 64 * 1024;
/** Найбільше відкритих `page`-тривог у відповіді (AC-32). */
export const OVERVIEW_MAX_ALARMS = 100;

export const BLOCK_KEYS = ['alarms', 'logAlarms', 'time', 'scheduler', 'catalog', 'site', 'live', 'moderation', 'backups', 'telegram', 'spend', 'pending'] as const;
export type OverviewBlockKey = (typeof BLOCK_KEYS)[number];

const iso = z.string();
const nullableIso = iso.nullable();

export const AlarmItemSchema = z.object({
  id: z.string(),
  source: z.string(),
  code: z.string(),
  kind: z.string(),
  /** Домен реєстру; `null` — невідомий вид (AC-27). */
  domain: z.string().nullable(),
  domainTitle: z.string().nullable(),
  raisedAt: iso,
  meaning: z.string().nullable(),
  action: z.string().nullable(),
});

export const AlarmsBlockSchema = z.object({ total: z.number().int(), items: z.array(AlarmItemSchema) });

export const LogAlarmGroupSchema = z.object({
  domain: z.string().nullable(),
  domainTitle: z.string().nullable(),
  kind: z.string(),
  count: z.number().int(),
  lastAt: iso,
});
export const LogAlarmsBlockSchema = z.object({ since: iso, total: z.number().int(), groups: z.array(LogAlarmGroupSchema) });

export const TimeBlockSchema = z.object({
  edgeSkewMs: z.number().nullable(),
  thresholdMs: z.number(),
  /** `null` — розбіжності ще не заміряно. */
  over: z.boolean().nullable(),
  virtual: z.boolean(),
  speed: z.number(),
});

export const SchedulerBlockSchema = z.object({
  holder: z.string().nullable(),
  epoch: z.number(),
  /** Затримка знана лише процесу-власнику оренди; інакше `null`. */
  lagMs: z.number().nullable(),
  lagThresholdMs: z.number(),
  over: z.boolean().nullable(),
  renewedAgeMs: z.number().nullable(),
  missed24h: z.number().int(),
});

export const CatalogBlockSchema = z.object({
  seasonKey: z.string().nullable(),
  generatedAt: z.string().nullable(),
  r2LastOkAt: nullableIso,
  r2LastFailedAt: nullableIso,
});

export const SiteBlockSchema = z.object({
  version: z.number(),
  outage: z.boolean(),
  paymentsPause: z.string().nullable(),
  switches: z.record(z.string(), z.boolean()),
});

export const LiveBlockSchema = z.object({
  version: z.number(),
  quota: z.array(z.object({ bucket: z.string(), used: z.number(), perDay: z.number(), percent: z.number() })),
  sources: z.object({ total: z.number().int(), dead: z.number().int(), hidden: z.number().int() }),
});

const spendBucket = z.object({ usd: z.number(), ceilingUsd: z.number(), percent: z.number() }).nullable();
export const ModerationBlockSchema = z.object({
  tasks: z.array(z.object({ task: z.string(), state: z.string(), reason: z.string().nullable() })),
  providers: z.array(z.object({ provider: z.string(), task: z.string(), status: z.string() })),
  night: spendBucket,
  month: spendBucket,
});

const runShape = z.object({ at: iso, result: z.enum(['ok', 'failed']) });
export const BackupsBlockSchema = z.object({
  last: runShape.extend({ kind: z.string(), stage: z.string().nullable(), size: z.number().nullable() }).nullable(),
  lastOk: z.object({ at: iso, size: z.number().nullable(), ageMs: z.number() }).nullable(),
  /** `null` — відновлення ще не заміряно. */
  lastRestore: runShape.extend({ durationMs: z.number().nullable(), lossWindowMs: z.number().nullable() }).nullable(),
});

export const TelegramBlockSchema = z.object({
  status: z.enum(['configured', 'not-configured']),
  lastDeliveredAt: nullableIso,
  inWindow: z.boolean(),
  /** Хвилин від останнього доставленого контрольного повідомлення (або від початку вікна); `null` поза вікном. */
  silentForMs: z.number().nullable(),
  red: z.boolean(),
});

export const SpendRowSchema = z.object({
  key: z.string(),
  title: z.string(),
  unit: z.enum(['units', 'usd']),
  amount: z.number().nullable(),
  ceiling: z.number().nullable(),
  percent: z.number().nullable(),
  state: z.enum(['ok', 'no-provider', 'unknown']),
  note: z.string().optional(),
});
export const SpendBlockSchema = z.object({ rows: z.array(SpendRowSchema) });

export const PendingBlockSchema = z.object({
  rows: z.array(z.object({ domain: z.string(), domainTitle: z.string(), metricKey: z.string(), title: z.string(), ownerWave: z.string() })),
});

export const OverviewSchema = z.object({
  at: iso,
  env: z.string(),
  blocks: z.object({
    alarms: AlarmsBlockSchema.nullable(),
    logAlarms: LogAlarmsBlockSchema.nullable(),
    time: TimeBlockSchema.nullable(),
    scheduler: SchedulerBlockSchema.nullable(),
    catalog: CatalogBlockSchema.nullable(),
    site: SiteBlockSchema.nullable(),
    live: LiveBlockSchema.nullable(),
    moderation: ModerationBlockSchema.nullable(),
    backups: BackupsBlockSchema.nullable(),
    telegram: TelegramBlockSchema.nullable(),
    spend: SpendBlockSchema.nullable(),
    pending: PendingBlockSchema.nullable(),
  }),
  errors: z.array(z.enum(BLOCK_KEYS)),
});

export type Overview = z.infer<typeof OverviewSchema>;
export type AlarmsBlock = z.infer<typeof AlarmsBlockSchema>;
export type LogAlarmsBlock = z.infer<typeof LogAlarmsBlockSchema>;
export type SpendRow = z.infer<typeof SpendRowSchema>;
export type OverviewBlocks = Overview['blocks'];
