import { describe, expect, it } from 'vitest';
import type { ApiErrorCode } from '../src/result';
import { fail } from '../src/result';
import { ApiFailureSchema, TestClockSetSchema, TimeResponseSchema } from '../src/schemas';

const CODES: ApiErrorCode[] = [
  'network',
  'unavailable',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'validation',
  'unknown',
];

describe('wire schemas', () => {
  it.each(CODES)('ApiFailureSchema accepts fail(%s)', (code) => {
    expect(ApiFailureSchema.safeParse(fail(code)).success).toBe(true);
  });

  it('TimeResponseSchema rejects fractions, negatives and extra keys', () => {
    expect(TimeResponseSchema.safeParse({ now: 1 }).success).toBe(true);
    expect(TimeResponseSchema.safeParse({ now: 1.5 }).success).toBe(false);
    expect(TimeResponseSchema.safeParse({ now: -1 }).success).toBe(false);
    expect(TimeResponseSchema.safeParse({ now: 1, extra: 1 }).success).toBe(false);
  });

  it('TestClockSetSchema bounds', () => {
    expect(TestClockSetSchema.safeParse({ at: 0, speed: 600, frozen: true }).success).toBe(true);
    for (const bad of [{ speed: 601 }, { speed: -1 }, { speed: 1.5 }, { at: -5 }]) {
      expect(TestClockSetSchema.safeParse(bad).success).toBe(false);
    }
  });
});
