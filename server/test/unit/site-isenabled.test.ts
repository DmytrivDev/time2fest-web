/** `isEnabled` on the server (SPEC-08 AC-15, server half): the same table the site test imports. */
import { describe, expect, it } from 'vitest';
import { isEnabled } from '@time2fest/contracts';
import { buildIsEnabledTable } from '../../../packages/contracts/test/isEnabled.table';

describe('isEnabled (server)', () => {
  const table = buildIsEnabledTable();
  it('has rows', () => {
    expect(table.length).toBeGreaterThan(0);
  });
  for (const row of table) {
    it(row.name, () => {
      expect(isEnabled(row.switches, row.target)).toBe(row.expected);
    });
  }
});
