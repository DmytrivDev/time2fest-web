import { describe, expect, it } from 'vitest';
import { isEnabled } from '../src/index';
import { buildIsEnabledTable } from './isEnabled.table';

describe('isEnabled (AC-15)', () => {
  const table = buildIsEnabledTable();

  it('covers 2^n rows per target kind', () => {
    const count = (kind: string) => table.filter((r) => r.target.kind === kind).length;
    expect(count('product')).toBe(2 * 4); // 2 keys x 2^2
    expect(count('tier')).toBe(3 * 8); // 3 tiers x 2^3
    expect(count('room')).toBe(6); // chat x room state (absent/true/false)
    expect(count('switch')).toBe(4 * 2);
  });

  it.each(table.map((r) => [r.name, r] as const))('%s', (_name, row) => {
    expect(isEnabled(row.switches, row.target)).toBe(row.expected);
  });
});
