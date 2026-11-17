/**
 * Environment-schema registry (AC-62): one block per owning capability, sorted by `key`.
 * R2 and AI variables are added by their owner waves as new blocks or rows.
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

export const envRegistry: readonly EnvBlock[] = [
  {
    key: 'edge',
    vars: [
      { name: 'T2F_EDGE_SECRET', schema: z.string().min(32).optional(), secret: true, requiredIn: ['rehearsal', 'production'] },
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
      { name: 'T2F_WEB_PORT', schema: port.optional() },
      { name: 'T2F_LOCK_DIR', schema: z.string().optional() },
      { name: 'T2F_ALLOWED_ORIGINS', schema: origins.optional(), requiredIn: ['production'] },
      { name: 'DATABASE_URI', schema: z.url(), secret: true, isolated: true },
      { name: 'REDIS_URL', schema: z.url(), secret: true, isolated: true },
      { name: 'T2F_REDIS_PREFIX', schema: z.string().optional() },
      { name: 'T2F_CENTRIFUGO_URL', schema: z.url().optional(), isolated: true },
      { name: 'T2F_CENTRIFUGO_PREFIX', schema: z.string().optional() },
      { name: 'SMTP_HOST', schema: z.string().optional(), isolated: true },
      { name: 'SMTP_PORT', schema: port.optional(), isolated: true },
      { name: 'PAYLOAD_SECRET', schema: z.string().min(32), secret: true },
      { name: 'PAYPRO_MODE', schema: z.enum(['sandbox', 'live']).default('sandbox'), isolated: true },
    ],
  },
];
