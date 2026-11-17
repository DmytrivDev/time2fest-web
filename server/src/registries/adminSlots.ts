/**
 * Admin first-screen slots (AC-26, AC-28): sorted by `key`, whose number prefix is the display
 * order. The test slice exists only in the `test` class — in every other class it is not even listed.
 */
import { assertRegistry } from '../platform/registry';
import type { EnvClass } from '../platform/env';

export interface AdminSlotRow {
  key: string;
  order: number;
  /** Ukrainian title shown above the slice and in the error placeholder. */
  label: string;
  /** Payload component path (`<path under src>#<Export>`) of the slice. */
  component: string;
  testOnly?: true;
}

export const adminSlotRegistry: readonly AdminSlotRow[] = [
  { key: '10-corrections', order: 10, label: 'Поправки подій', component: '/admin/CorrectionsSlice#CorrectionsSlice' },
  { key: '20-unattended', order: 20, label: 'Режим без нагляду', component: '/admin/UnattendedSlice#UnattendedSlice' },
  { key: '90-test', order: 90, label: 'Тестовий зріз', component: '/admin/TestSlice#TestSlice', testOnly: true },
];

assertRegistry('admin-slots', adminSlotRegistry, (r) => r.key);

/** The slots shown in the given class, in display order. */
export function visibleSlots(cls: EnvClass, rows: readonly AdminSlotRow[] = adminSlotRegistry): AdminSlotRow[] {
  return rows.filter((r) => !r.testOnly || cls === 'test').sort((a, b) => a.order - b.order);
}

/** `globalThis` key of the test door `admin-test-slice` (`{ fail: true }` makes the test slice throw). */
export const ADMIN_TEST_SLICE_FAIL = Symbol.for('t2f.adminTestSliceFail');
