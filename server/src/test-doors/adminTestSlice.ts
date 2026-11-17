/**
 * `POST /api/_test/admin-test-slice` (AC-27): `{ fail: boolean }` sets a process flag that the admin
 * first screen reads for the test slice, which then throws after mount. Part of the doors module, so
 * it exists only in the `test` class with `T2F_TEST_DOORS=1`.
 */
import { z } from 'zod';
import { ADMIN_TEST_SLICE_FAIL } from '../registries/adminSlots';
import type { DoorRow } from './registry';

export const AdminTestSliceBodySchema = z.object({ fail: z.boolean() }).strict();

export const adminTestSliceDoor: DoorRow = {
  key: 'admin-test-slice',
  method: 'POST',
  path: '/api/_test/admin-test-slice',
  body: AdminTestSliceBodySchema,
  async handler(ctx) {
    const { fail } = ctx.body as z.infer<typeof AdminTestSliceBodySchema>;
    (globalThis as Record<symbol, unknown>)[ADMIN_TEST_SLICE_FAIL] = fail;
    return { ok: true, value: { fail } };
  },
};
