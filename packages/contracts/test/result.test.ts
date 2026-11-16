import { describe, expect, it } from 'vitest';
import { fail, ok, type ApiErrorCode } from '../src/index';

describe('result', () => {
  it('ok wraps a value', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });
  it('fail carries code and extras', () => {
    expect(fail('conflict', { reason: 'x' })).toEqual({ ok: false, error: { code: 'conflict', reason: 'x' } });
    expect(fail('network')).toEqual({ ok: false, error: { code: 'network' } });
  });
  it('has exactly the 9 error codes', () => {
    const codes: Record<ApiErrorCode, true> = {
      network: true,
      unavailable: true,
      unauthorized: true,
      forbidden: true,
      not_found: true,
      conflict: true,
      rate_limited: true,
      validation: true,
      unknown: true,
    };
    expect(Object.keys(codes)).toHaveLength(9);
  });
});
