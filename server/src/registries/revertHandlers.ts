/**
 * Revert-handler registry (AC-22, AC-24): sorted, unique rows keyed by journal action kind, one line per
 * domain; the handlers are in `adapters/payloadRevert.ts`. A journal row is `revertible` exactly when its
 * action has a row here (`isRevertible`, the one helper every caller uses).
 */
import type { PayloadRequest } from 'payload';
import { resolveActor } from '../audit/journal';
import type { RevertHandler } from '../audit/ports';
import { collectionUpdate, correctionSave, unattendedSetManual } from '../adapters/payloadRevert';
import { processDeps } from '../adapters/processDeps';
import { siteOf } from '../endpoints/deps';
import { assertRegistry } from '../platform/registry';
import { siteRevertHandlers, type SiteDeps } from '../site/service';

/** The process's site deps (SPEC-08), wired by the composition root. */
async function siteDeps(): Promise<SiteDeps> {
  return siteOf(await processDeps());
}

/** `site.product`, `site.switch`: the reverting owner, from the revert's request. */
const [siteProduct, siteSwitch] = siteRevertHandlers(siteDeps, (tx) => {
  const req = tx as PayloadRequest;
  return { ...resolveActor(req.user, req.context), kind: 'owner' };
}) as [RevertHandler, RevertHandler];

export const revertHandlerRegistry: readonly RevertHandler[] = [
  collectionUpdate,
  correctionSave,
  siteProduct,
  siteSwitch,
  unattendedSetManual,
];

assertRegistry('revert-handlers', revertHandlerRegistry, (r) => r.key);

/** The action has a revert handler, so its journal row is revertible. */
export function isRevertible(action: string): boolean {
  return revertHandlerRegistry.some((r) => r.key === action);
}
