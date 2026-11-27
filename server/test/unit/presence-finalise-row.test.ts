// SPEC-14 fix-mode W4 — the `presence-finalise` moments row: a window not due yet returns quietly (the 5 s ticker
// finalises it), only a failed write throws so the scheduler retries.
import { describe, expect, it } from 'vitest';
import { createPresenceFinaliseRow, FinaliseFailed, type Finaliser, type FinaliseReport } from '../../src/presence/health';
import type { ActionContext, MomentActionGroup } from '../../src/scheduler/ports';

function rowWith(report: FinaliseReport) {
  const calls: string[][] = [];
  const finaliser = {
    finaliseEvents: async (ids: readonly string[]) => (calls.push([...ids]), report),
  } as unknown as Finaliser;
  return { row: createPresenceFinaliseRow(async () => finaliser), calls };
}

const group = { action: 'presence-finalise', at: 0, now: 0, consequenceId: 'c', moments: [{ eventId: 'e1' }, { eventId: 'e1' }] } as unknown as MomentActionGroup;
const ctx = {} as ActionContext;

describe('presence-finalise row (W4)', () => {
  it('a window still open → resolves without throwing', async () => {
    const r = rowWith({ written: 0, failed: 0, notDue: 1 });
    await expect(r.row.run(group, ctx)).resolves.toBeUndefined();
    expect(r.calls).toEqual([['e1']]);
  });

  it('a failed write → FinaliseFailed (retried)', async () => {
    await expect(rowWith({ written: 0, failed: 1, notDue: 1 }).row.run(group, ctx)).rejects.toBeInstanceOf(FinaliseFailed);
  });

  it('written → resolves', async () => {
    await expect(rowWith({ written: 1, failed: 0, notDue: 0 }).row.run(group, ctx)).resolves.toBeUndefined();
  });
});
