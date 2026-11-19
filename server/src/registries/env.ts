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
const usdPerMTok = z.string().regex(/^\d+(\.\d+)?$/);

const hostPort = z.string().regex(/^[a-z0-9.-]+(:\d{1,5})?$/i);

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
];
