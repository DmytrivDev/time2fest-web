/**
 * Revert-handler registry (AC-22, AC-24): sorted, unique rows keyed by journal action kind, one line per
 * domain; the handlers are in `adapters/payloadRevert.ts`. A journal row is `revertible` exactly when its
 * action has a row here (`isRevertible`, the one helper every caller uses).
 */
import type { RevertHandler } from '../audit/ports';
import { collectionUpdate, correctionSave, unattendedSetManual } from '../adapters/payloadRevert';
import { assertRegistry } from '../platform/registry';

export const revertHandlerRegistry: readonly RevertHandler[] = [
  collectionUpdate,
  correctionSave,
  unattendedSetManual,
];

assertRegistry('revert-handlers', revertHandlerRegistry, (r) => r.key);

/** The action has a revert handler, so its journal row is revertible. */
export function isRevertible(action: string): boolean {
  return revertHandlerRegistry.some((r) => r.key === action);
}
