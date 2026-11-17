/** Zod wire schemas of the realtime contract (SPEC-06). Server and tests only. */
import { z } from 'zod';
import {
  REALTIME_MAX_BATCH_EVENTS,
  type RealtimeBatch,
  type RealtimeEnvelope,
  type RealtimeTokenValue,
} from './realtime';

export const RealtimeEnvelopeSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1).max(64),
    version: z.number().int().min(0).optional(),
    data: z.unknown().optional(),
  })
  .strict() satisfies z.ZodType<RealtimeEnvelope>;

export const RealtimeBatchSchema = z
  .object({
    type: z.literal('batch'),
    id: z.string().min(1).max(64),
    events: z.array(RealtimeEnvelopeSchema).min(1).max(REALTIME_MAX_BATCH_EVENTS),
  })
  .strict() satisfies z.ZodType<RealtimeBatch>;

export const RealtimeTokenValueSchema = z
  .object({
    token: z.string().min(1).nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((v) => (v.token === null) === (v.expiresAt === null), {
    message: 'token and expiresAt are both null or both set',
  }) satisfies z.ZodType<RealtimeTokenValue>;

/** Body of `POST /api/_test/realtime-token` (test doors only). */
export const TestRealtimeTokenBodySchema = z
  .object({
    subject: z
      .object({
        kind: z.enum(['guest', 'account']),
        id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      })
      .strict(),
    ttlSeconds: z.number().int().min(1).max(4500).optional(),
  })
  .strict();
export type TestRealtimeTokenBody = z.infer<typeof TestRealtimeTokenBodySchema>;
