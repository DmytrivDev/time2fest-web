/**
 * Environment-schema registry (AC-62): one block per owning capability, sorted by `key`.
 * AI variables are added by their owner wave as a new block.
 */
import { z } from 'zod';
import type { EnvBlock } from '../platform/env';

const intIn = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

const port = intIn(1, 65_535);

function isOrigin(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === s;
  } catch {
    return false;
  }
}

const origins = z
  .string()
  .transform((s) => s.split(',').map((o) => o.trim()).filter((o) => o !== ''))
  .refine((list) => list.length > 0 && list.every(isOrigin));

const REQ = ['rehearsal', 'production'] as const;

const csv = z
  .string()
  .transform((s) => s.split(',').map((o) => o.trim()).filter((o) => o !== ''))
  .refine((list) => list.length > 0);

const httpsUrl = z.string().refine((s) => {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
});

/** USD per million tokens as a decimal string (parsed where the spend is computed). */
/** A share in (0, 1], decimal: `0.2`. */
const share = z.string().regex(/^\d+(\.\d+)?$/).transform(Number).pipe(z.number().gt(0).max(1));

const usdPerMTok = z.string().regex(/^\d+(\.\d+)?$/);

const hostPort = z.string().regex(/^[a-z0-9.-]+(:\d{1,5})?$/i);

/** Canonical base64 of exactly 32 bytes (AES-256 key of the backups, SPEC-13b AC-41). */
const backupKey = z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/);

/** A Telegram chat id: a (possibly negative) integer or a public `@channel` name. */
const telegramChatId = z.string().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/);

export const envRegistry: readonly EnvBlock[] = [
  {
    key: 'access',
    vars: [
      { name: 'T2F_ACCESS_AUD', schema: z.string().min(1).optional(), requiredIn: REQ },
      // A URL, or the literal `test-signer:` (the test signer replaces the remote key set).
      {
        name: 'T2F_ACCESS_JWKS_URL',
        schema: z.union([z.literal('test-signer:'), z.url()]).optional(),
        requiredIn: REQ,
      },
      { name: 'T2F_ACCESS_SERVICE_CNS', schema: csv.optional() },
      { name: 'T2F_ACCESS_TEAM_DOMAIN', schema: httpsUrl.optional(), requiredIn: REQ },
      { name: 'T2F_ADMIN_HOST', schema: hostPort.optional(), isolated: true, requiredIn: REQ },
      { name: 'T2F_OWNER_EMAILS', schema: csv.optional(), requiredIn: REQ },
    ],
  },
  {
    key: 'ai',
    vars: [
      // Provider keys are optional: absence means `not-configured`, never a boot failure (SPEC-09 AC-47).
      { name: 'ANTHROPIC_API_KEY', schema: z.string().min(1).optional(), secret: true },
      { name: 'DEEPSEEK_API_KEY', schema: z.string().min(1).optional(), secret: true },
      // Base addresses default to the real hosts only outside `test`, where the adapters are built.
      { name: 'T2F_AI_ANTHROPIC_MODEL', schema: z.string().min(1).default('claude-haiku-5-5') },
      { name: 'T2F_AI_ANTHROPIC_PRICE_CACHE_READ', schema: usdPerMTok.default('0.01') },
      { name: 'T2F_AI_ANTHROPIC_PRICE_CACHE_WRITE', schema: usdPerMTok.default('0.125') },
      { name: 'T2F_AI_ANTHROPIC_PRICE_INPUT', schema: usdPerMTok.default('0.10') },
      { name: 'T2F_AI_ANTHROPIC_PRICE_OUTPUT', schema: usdPerMTok.default('0.50') },
      { name: 'T2F_AI_ANTHROPIC_URL', schema: z.url().optional() },
      { name: 'T2F_AI_ANTHROPIC_VERSION', schema: z.string().min(1).default('2026-10-21') },
      { name: 'T2F_AI_DEEPSEEK_MODEL', schema: z.string().min(1).default('deepseek-flash') },
      { name: 'T2F_AI_DEEPSEEK_PRICE_CACHE_HIT', schema: usdPerMTok.default('0.006') },
      { name: 'T2F_AI_DEEPSEEK_PRICE_CACHE_MISS', schema: usdPerMTok.default('0.30') },
      { name: 'T2F_AI_DEEPSEEK_PRICE_OUTPUT', schema: usdPerMTok.default('1.20') },
      { name: 'T2F_AI_DEEPSEEK_URL', schema: z.url().optional() },
      // User AI calls a minute per provider for the whole ACCOUNT (security S7); each server process takes
      // floor(budget / T2F_AI_PROCESSES) as its token bucket. Anthropic: 85 % of the owner-verified 4 000 RPM.
      { name: 'T2F_AI_ANTHROPIC_RPM', schema: intIn(1, 1_000_000).default(3_400) },
      { name: 'T2F_AI_DEEPSEEK_RPM', schema: intIn(1, 1_000_000).default(1_000) },
      // Number of server processes sharing the AI accounts (positive integer).
      { name: 'T2F_AI_PROCESSES', schema: intIn(1, 1_000).default(1) },
      // Share of each spend ceiling (night, month) that POST /api/toasts/check may use (security S4).
      { name: 'T2F_AI_TOASTS_SPEND_SHARE', schema: share.default(0.2) },
      // Share of each provider's RPM reserved for POST /api/toasts/check; chat, nick and translation use the rest (security N1).
      { name: 'T2F_AI_TOASTS_RPM_SHARE', schema: z.string().regex(/^0?\.\d+$/).transform(Number).pipe(z.number().gt(0).lt(1)).default(0.2) },
    ],
  },
  {
    // SPEC-10: sign-in. Google is off while T2F_GOOGLE_DISCOVERY_URL is unset. In `test` the discovery URL must be
    // loopback (the fake OIDC), elsewhere `https:` (platform/env.ts, AC-47).
    key: 'auth',
    vars: [
      { name: 'T2F_AUTH_SECRET', schema: z.string().min(32).optional(), secret: true, requiredIn: REQ },
      { name: 'T2F_GOOGLE_CLIENT_ID', schema: z.string().min(1).optional() },
      { name: 'T2F_GOOGLE_CLIENT_SECRET', schema: z.string().min(1).optional(), secret: true },
      { name: 'T2F_GOOGLE_DISCOVERY_URL', schema: z.url().optional(), isolated: true },
      { name: 'T2F_SEASON_END', schema: z.iso.datetime().default('2027-01-15T00:00:00Z') },
    ],
  },
  {
    key: 'catalog',
    vars: [
      { name: 'T2F_CATALOG_RATE_PER_MIN', schema: intIn(1, 10_000).default(30) },
      { name: 'T2F_R2_ACCESS_KEY_ID', schema: z.string().min(1).optional(), secret: true, requiredIn: REQ },
      { name: 'T2F_R2_BUCKET', schema: z.string().min(1).optional(), isolated: true, requiredIn: REQ },
      { name: 'T2F_R2_ENDPOINT', schema: z.url().optional(), isolated: true, requiredIn: REQ },
      { name: 'T2F_R2_PREFIX', schema: z.string().regex(/^[a-z0-9_]+\/$/).optional(), requiredIn: REQ },
      { name: 'T2F_R2_SECRET_ACCESS_KEY', schema: z.string().min(1).optional(), secret: true, requiredIn: REQ },
    ],
  },
  {
    key: 'edge',
    vars: [
      { name: 'T2F_EDGE_SECRET', schema: z.string().min(32).optional(), secret: true, requiredIn: ['rehearsal', 'production'] },
      { name: 'T2F_EDGE_SECRET_PREVIOUS', schema: z.string().min(32).optional(), secret: true },
    ],
  },
  {
    // SPEC-12: live air. Everything is optional in every class: without T2F_YOUTUBE_BASE_URL the poller does not start.
    key: 'live',
    vars: [
      { name: 'T2F_LIVE_CONFIG', schema: z.string().min(1).optional() },
      { name: 'T2F_YOUTUBE_API_KEY', schema: z.string().min(1).optional(), secret: true },
      { name: 'T2F_YOUTUBE_BASE_URL', schema: z.url().optional() },
    ],
  },
  {
    // SPEC-10: mail. Main transport = SMTP_HOST / SMTP_PORT (block `platform`) + SMTP_USER / SMTP_PASSWORD (Resend);
    // fallback = SMTP_FALLBACK_* (Cloudflare Email Service). In `test` both hosts must be loopback (AC-47).
    key: 'mail',
    vars: [
      { name: 'SMTP_FALLBACK_DAILY_CEILING', schema: intIn(1, 1_000_000).default(100) },
      { name: 'SMTP_FALLBACK_HOST', schema: z.string().min(1).optional(), isolated: true },
      { name: 'SMTP_FALLBACK_PASSWORD', schema: z.string().min(1).optional(), secret: true },
      { name: 'SMTP_FALLBACK_PORT', schema: port.optional() },
      { name: 'SMTP_FALLBACK_USER', schema: z.string().min(1).optional() },
      { name: 'SMTP_PASSWORD', schema: z.string().min(1).optional(), secret: true },
      { name: 'SMTP_USER', schema: z.string().min(1).optional() },
      { name: 'T2F_MAIL_DAILY_CEILING', schema: intIn(1, 1_000_000).default(100) },
      { name: 'T2F_MAIL_FROM', schema: z.string().min(3).default('Time2Fest <code@mail.time2fest.com>') },
      { name: 'T2F_MAIL_PLAN', schema: z.enum(['free', 'pro']).default('free') },
    ],
  },
  {
    // SPEC-13b: Telegram alarms and encrypted backups. Optional in `test` and `rehearsal` (absent: the
    // Telegram sink is off / the backup does not start, AC-14, AC-48); required in production (AC-67).
    key: 'ops',
    vars: [
      { name: 'T2F_BACKUP_KEY', schema: backupKey.optional(), secret: true, requiredIn: ['production'] },
      // In `test` a non-loopback base only switches the sink off (`telegramDisabledReason`), never a refusal (AC-13).
      { name: 'T2F_TELEGRAM_API_BASE', schema: z.url().optional() },
      { name: 'T2F_TELEGRAM_BOT_TOKEN', schema: z.string().min(1).optional(), secret: true, requiredIn: ['production'] },
      { name: 'T2F_TELEGRAM_CHAT_ID', schema: telegramChatId.optional(), requiredIn: ['production'] },
      { name: 'T2F_TELEGRAM_TEST_CHAT_ID', schema: telegramChatId.optional() },
    ],
  },
  {
    key: 'platform',
    vars: [
      // Classified by envClass(); any string is accepted here, unknown values fall to production.
      { name: 'T2F_ENV', schema: z.string().optional() },
      { name: 'T2F_TEST_DOORS', schema: z.literal('1').optional() },
      { name: 'T2F_SLOT', schema: intIn(0, 47).optional() },
      { name: 'T2F_SLUG', schema: z.string().regex(/^[a-z0-9_]{1,40}$/).optional() },
      { name: 'T2F_SERVER_PORT', schema: port.optional() },
      { name: 'T2F_HOST', schema: z.union([z.ipv4(), z.string().regex(/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i)]).optional() },
      { name: 'T2F_COMMIT', schema: z.string().regex(/^[0-9a-f]{40}$/).optional() },
      { name: 'T2F_WEB_PORT', schema: port.optional() },
      { name: 'T2F_LOCK_DIR', schema: z.string().optional() },
      { name: 'T2F_ALLOWED_ORIGINS', schema: origins.optional(), requiredIn: ['production'] },
      { name: 'DATABASE_URI', schema: z.url(), secret: true, isolated: true },
      { name: 'REDIS_URL', schema: z.url(), secret: true, isolated: true },
      { name: 'T2F_REDIS_PREFIX', schema: z.string().optional(), isolated: true },
      { name: 'T2F_CENTRIFUGO_URL', schema: z.url().optional(), isolated: true },
      { name: 'T2F_CENTRIFUGO_PREFIX', schema: z.string().optional() },
      { name: 'SMTP_HOST', schema: z.string().optional(), isolated: true },
      { name: 'SMTP_PORT', schema: port.optional(), isolated: true },
      { name: 'PAYLOAD_SECRET', schema: z.string().min(32), secret: true },
      { name: 'PAYPRO_MODE', schema: z.enum(['sandbox', 'live']).default('sandbox'), isolated: true },
    ],
  },
  {
    // SPEC-06: Centrifugo HTTP API key and the HMAC key of connection tokens (≥256 bit, AC-20).
    // T2F_CENTRIFUGO_URL / _PREFIX stay in `platform`; their class rules are in domain/realtime/config.ts.
    key: 'realtime',
    vars: [
      { name: 'T2F_CENTRIFUGO_API_KEY', schema: z.string().min(32).optional(), secret: true, requiredIn: REQ },
      { name: 'T2F_CENTRIFUGO_TOKEN_SECRET', schema: z.string().min(32).optional(), secret: true, requiredIn: REQ },
    ],
  },
  {
    // SPEC-08: edge purge after a site change and the catalog rebuild launch. All optional in every class:
    // absence means the purge or the launch is skipped with a log line, never a boot failure (AC-34).
    key: 'site',
    vars: [
      { name: 'T2F_CF_PURGE_TOKEN', schema: z.string().min(1).optional(), secret: true },
      { name: 'T2F_CF_ZONE_ID', schema: z.string().regex(/^[0-9a-f]{32}$/).optional() },
      { name: 'T2F_GITHUB_DISPATCH_TOKEN', schema: z.string().min(1).optional(), secret: true },
      { name: 'T2F_REBUILD_PRODUCTION', schema: z.enum(['0', '1']).default('0') },
      { name: 'T2F_SITE_URL', schema: z.url().optional() },
    ],
  },
];
