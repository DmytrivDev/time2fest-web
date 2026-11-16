/** Zod wire schemas (SPEC-02). Server and tests only: never re-exported from index.ts, so the site bundle stays zod-free. */
import { z } from 'zod';
import type { ApiErrorCode } from './result';

export const ApiErrorCodeSchema = z.enum([
  'network',
  'unavailable',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'validation',
  'unknown',
]) satisfies z.ZodType<ApiErrorCode>;

export const ApiErrorSchema = z
  .object({
    code: ApiErrorCodeSchema,
    reason: z.string().optional(),
    retryAfterMs: z.number().int().positive().optional(),
    attemptsLeft: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
  })
  .strict();

export function apiResultSchema<T extends z.ZodType>(value: T) {
  return z.union([
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: ApiErrorSchema }).strict(),
  ]);
}

export const ApiFailureSchema = z.object({ ok: z.literal(false), error: ApiErrorSchema }).strict();

export const TimeResponseSchema = z.object({ now: z.number().int().nonnegative() }).strict();
export type TimeResponse = z.infer<typeof TimeResponseSchema>;

export const TestClockSetSchema = z
  .object({
    at: z.number().int().nonnegative().optional(),
    speed: z.number().int().min(0).max(600).optional(),
    frozen: z.boolean().optional(),
  })
  .strict();
export type TestClockSet = z.infer<typeof TestClockSetSchema>;

export const TestClockStateSchema = z
  .object({
    now: z.number().int().nonnegative(),
    speed: z.number().int().min(0).max(600),
    frozen: z.boolean(),
  })
  .strict();
export type TestClockState = z.infer<typeof TestClockStateSchema>;

export const TestFixturesBodySchema = z.object({ name: z.string().min(1).max(64) }).strict();
export type TestFixturesBody = z.infer<typeof TestFixturesBodySchema>;
