import { parseSiteState } from '@time2fest/contracts';
import { describe, expect, it } from 'vitest';
import type { SiteService } from '@/lib/api/contracts/site';

/**
 * One behaviour suite for the `site` domain (SPEC-08 AC-2), run on the sim adapter and on the http adapter against
 * this worktree's server (after the reset doors: every switch on, no outage).
 */
export function describeDomain(name: string, makeService: () => SiteService): void {
  describe(name, () => {
    it('state() returns a snapshot that passes the wire schema (AC-1)', async () => {
      const r = await makeService().state();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(parseSiteState(r.value)).not.toBeNull();
      expect(r.value.version).toBeGreaterThanOrEqual(1);
      expect(r.value.catalogVersion.length).toBeGreaterThan(0);
    });

    it('the reset state has every switch on and no outage', async () => {
      const r = await makeService().state();
      if (!r.ok) throw new Error(`state() → ${r.error.code}`);
      const { chatRooms, toastTiers, ...flags } = r.value.switches;
      expect(Object.values(flags).every((v) => v === true)).toBe(true);
      expect(Object.values(chatRooms).every((v) => v === true)).toBe(true);
      expect(toastTiers).toEqual({ '2': true, '5': true, '10': true });
      expect(r.value.outage).toBeUndefined();
    });

    it('every product carries a price in USD cents', async () => {
      const r = await makeService().state();
      if (!r.ok) throw new Error(`state() → ${r.error.code}`);
      for (const p of r.value.products) {
        expect(p.price.currency).toBe('USD');
        expect(Number.isInteger(p.price.amount)).toBe(true);
        expect(p.price.amount).toBeGreaterThan(0);
      }
    });

    it('peek() after state() is the snapshot state() returned', async () => {
      const svc = makeService();
      const r = await svc.state();
      if (!r.ok) throw new Error(`state() → ${r.error.code}`);
      expect(svc.peek()).toEqual(r.value);
    });

    it('subscribe() returns an unsubscribe that may be called twice', () => {
      const off = makeService().subscribe(() => {});
      expect(typeof off).toBe('function');
      off();
      off();
    });
  });
}
