/** AC-15 (web half): the site decides `isEnabled` by the same table as the server. */
import { describe, expect, it } from 'vitest';
import { isEnabled } from '@time2fest/contracts';
import { buildIsEnabledTable } from '../../../packages/contracts/test/isEnabled.table';

describe('isEnabled on the site (AC-15)', () => {
  it.each(buildIsEnabledTable().map((r) => [r.name, r] as const))('%s', (_name, row) => {
    expect(isEnabled(row.switches, row.target)).toBe(row.expected);
  });
});
