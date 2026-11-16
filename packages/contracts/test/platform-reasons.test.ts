import { describe, expect, it } from 'vitest';
import { PLATFORM_REASONS, fail, type PlatformReason } from '../src/result';

describe('platform reasons', () => {
  it('exports the three reasons', () => {
    expect([...PLATFORM_REASONS]).toEqual(['invalid-input', 'in-progress', 'lock-required']);
  });

  it('is valid with any code', () => {
    const reason: PlatformReason = 'invalid-input';
    const r = fail('validation', { reason });
    expect(r).toEqual({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
  });
});
