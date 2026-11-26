import { describe, expect, it } from 'vitest';
import { authorPathResponse } from '../src/schemas';

// SPEC-14 AC-49
describe('author path schema', () => {
  it('accepts points and hidden', () => {
    expect(authorPathResponse.safeParse({ points: [{ eventId: 'e', planned: false }], hidden: false }).success).toBe(true);
    expect(authorPathResponse.safeParse({ points: [], hidden: true }).success).toBe(true);
  });
  it('is strict', () => {
    expect(authorPathResponse.safeParse({ points: [], hidden: true, extra: 1 }).success).toBe(false);
    expect(authorPathResponse.safeParse({ points: [{ eventId: 'e', planned: true, authorId: 'x' }], hidden: false }).success).toBe(false);
    expect(authorPathResponse.safeParse({ points: [] }).success).toBe(false);
    expect(authorPathResponse.safeParse({ points: [{ eventId: 'e' }], hidden: false }).success).toBe(false);
  });
});
