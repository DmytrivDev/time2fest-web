/**
 * Admin first-screen slots (AC-26, AC-28): sorted by `key`, whose number prefix is the display
 * order. The test slice exists only in the `test` class — in every other class it is not even listed.
 */
import type { ReactNode } from 'react';
import { assertRegistry } from '../platform/registry';
import type { EnvClass } from '../platform/env';

/** What a slice component receives; `fail` is read by the test slice only. */
export interface SliceProps {
  fail: boolean;
}
export type SliceComponent = (props: SliceProps) => ReactNode | Promise<ReactNode>;

export interface AdminSlotRow {
  key: string;
  order: number;
  /** Ukrainian title shown above the slice and in the error placeholder. */
  label: string;
  /** Loads the slice component (the one place that names it); the test slice is never imported statically. */
  load: () => Promise<SliceComponent | undefined>;
  testOnly?: true;
}

export const adminSlotRegistry: readonly AdminSlotRow[] = [
  { key: '10-corrections', order: 10, label: 'Поправки подій', load: () => import('../admin/CorrectionsSlice').then((m) => m.CorrectionsSlice) },
  { key: '20-unattended', order: 20, label: 'Режим без нагляду', load: () => import('../admin/UnattendedSlice').then((m) => m.UnattendedSlice) },
  { key: '90-test', order: 90, label: 'Тестовий зріз', load: () => import('../admin/TestSlice').then((m) => m.TestSlice), testOnly: true },
];

assertRegistry('admin-slots', adminSlotRegistry, (r) => r.key);

/** The slots shown in the given class, in display order. */
export function visibleSlots(cls: EnvClass, rows: readonly AdminSlotRow[] = adminSlotRegistry): AdminSlotRow[] {
  return rows.filter((r) => !r.testOnly || cls === 'test').sort((a, b) => a.order - b.order);
}

/** `globalThis` key of the test door `admin-test-slice` (`{ fail: true }` makes the test slice throw). */
export const ADMIN_TEST_SLICE_FAIL = Symbol.for('t2f.adminTestSliceFail');

/** Sets the flag the test slice reads (the test door only). */
export function setAdminTestSliceFail(fail: boolean): void {
  (globalThis as Record<symbol, unknown>)[ADMIN_TEST_SLICE_FAIL] = fail;
}

/** Whether the test slice must throw after mount. */
export function adminTestSliceFails(): boolean {
  return (globalThis as Record<symbol, unknown>)[ADMIN_TEST_SLICE_FAIL] === true;
}
