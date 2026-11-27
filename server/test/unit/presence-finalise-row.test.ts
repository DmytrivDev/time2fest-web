// SPEC-14 fix-mode W4 — the `presence-finalise` moments row: a window not due yet returns quietly (the 5 s ticker
// finalises it), only a failed write throws so the scheduler retries.
import { describe, expect, it } from 'vitest';
import { createPresenceFinaliseRow, FinaliseFailed, type Finaliser, type FinaliseReport } from '../../src/presence/health';
import type { ActionContext, MomentActionGroup } from '../../src/scheduler/ports';
import { finaliseDueAt } from '../../src/domain/presence/healthSigns';
import { STAMP_DELAY } from '@time2fest/rules/time';

function rowWith(report: FinaliseReport) {
  const calls: string[][] = [];
  const finaliser = {
    finaliseEvents: async (ids: readonly string[]) => (calls.push([...ids]), report),
  } as unknown as Finaliser;
  return { row: createPresenceFinaliseRow(async () => finaliser), calls };
}

const M = Date.UTC(2031, 0, 1);
const stamp = M + STAMP_DELAY;
/** A late group: the stamp instant of moment M, run once M's window is due. */
const group = { action: 'presence-finalise', at: stamp, now: finaliseDueAt(M), consequenceId: 'c', moments: [{ eventId: 'e1', at: stamp }, { eventId: 'e1', at: stamp }] } as unknown as MomentActionGroup;
const ctx = {} as ActionContext;

describe('presence-finalise row (W4)', () => {
  it('a window still open → resolves without throwing', async () => {
    const r = rowWith({ written: 0, failed: 0, notDue: 1 });
    await expect(r.row.run(group, ctx)).resolves.toBeUndefined();
    expect(r.calls).toEqual([['e1']]);
  });

  it('an on-time stamp group (window not due) → returns before resolving the finaliser', async () => {
    let resolved = 0;
    const row = createPresenceFinaliseRow(async () => (resolved++, {} as Finaliser));
    await expect(row.run({ ...group, now: stamp } as MomentActionGroup, ctx)).resolves.toBeUndefined();
    await expect(row.run({ ...group, now: finaliseDueAt(M) - 1 } as MomentActionGroup, ctx)).resolves.toBeUndefined();
    expect(resolved).toBe(0);
  });

  it('a failed write → FinaliseFailed (retried)', async () => {
    await expect(rowWith({ written: 0, failed: 1, notDue: 1 }).row.run(group, ctx)).rejects.toBeInstanceOf(FinaliseFailed);
  });

  it('written → resolves', async () => {
    await expect(rowWith({ written: 1, failed: 0, notDue: 0 }).row.run(group, ctx)).resolves.toBeUndefined();
  });
});
