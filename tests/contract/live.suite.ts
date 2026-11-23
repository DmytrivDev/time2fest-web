import { parseChainsResponse, parseViewerSummary } from '@time2fest/contracts';
import { describe, expect, it } from 'vitest';
import type { LiveService } from '@/lib/api/contracts/live';

/**
 * One behaviour suite for the `live` domain (SPEC-12 AC-2), run on the sim adapter and on the http adapter against this
 * worktree's server (after the `reset-live` door).
 */
export function describeDomain(name: string, makeService: () => LiveService): void {
  describe(name, () => {
    it('chains() takes no parameters and returns a versioned answer that passes the wire guard (AC-3, AC-4)', async () => {
      const svc = makeService();
      // @ts-expect-error — `chains()` has no parameters ([А1]); never called, the compiler is the check.
      const withParam = () => svc.chains(['x']);
      void withParam;
      const r = await svc.chains();
      if (!r.ok) throw new Error(`chains() → ${r.error.code}`);
      expect(parseChainsResponse(r.value)).not.toBeNull();
      expect(Number.isInteger(r.value.version)).toBe(true);
      expect(r.value.version).toBeGreaterThanOrEqual(0);
      expect(r.value.chains.length).toBeGreaterThan(0);
      expect(new Set(r.value.chains.map((c) => c.eventId)).size).toBe(r.value.chains.length);
    });

    it('viewers() returns a summary that passes the wire guard; people, when present, is a non-negative integer', async () => {
      const r = await makeService().viewers();
      if (!r.ok) throw new Error(`viewers() → ${r.error.code}`);
      expect(parseViewerSummary(r.value)).not.toBeNull();
      if (r.value.people !== undefined) expect(Number.isInteger(r.value.people) && r.value.people >= 0).toBe(true);
    });

    it('reportSourceError() with a known code is accepted', async () => {
      const svc = makeService();
      const chains = await svc.chains();
      if (!chains.ok) throw new Error(`chains() → ${chains.error.code}`);
      const chain = chains.value.chains.find((c) => c.sources.length > 0)!;
      expect(await svc.reportSourceError({ eventId: chain.eventId, sourceId: chain.sources[0]!.id, code: 150 })).toEqual({
        ok: true,
        value: undefined,
      });
    });

    it('subscribeStreams() and subscribeViewers() return unsubscribes that may be called twice', () => {
      const svc = makeService();
      const offStreams = svc.subscribeStreams(() => {});
      const offViewers = svc.subscribeViewers(() => {});
      offStreams();
      offStreams();
      offViewers();
      offViewers();
    });
  });
}
