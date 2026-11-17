/**
 * Moments registry (AC-62): the scheduled instants the server acts on (for example the
 * midnight of a zone), sorted by `key`. Empty in SPEC-02; SPEC-07 fills it.
 */
import { assertRegistry } from '../platform/registry';

/** One scheduled moment: `at` is a UTC instant in epoch milliseconds. */
export interface MomentRow {
  key: string;
  /** What the moment triggers, named by its owning capability. */
  kind: string;
  at: number;
}

export const momentsRegistry: readonly MomentRow[] = [];

assertRegistry('moments', momentsRegistry, (m) => m.key);
