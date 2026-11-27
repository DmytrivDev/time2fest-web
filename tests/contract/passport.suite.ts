import { describe, expect, it } from 'vitest';
import type { PassportEvent, PassportService } from '@/lib/api/contracts/passport';
import type { Ms } from '@/lib/data/types';

/** What a passport suite run needs from the world around the adapter (sim: stores and a fake clock; http: the server's test doors). */
export interface PassportSuiteCtx {
  /** The event the suite stamps and its midnight `m`. */
  event(): { eventId: string; momentMs: Ms };
  /** Moves the site clock (sim: the fake clock the presence surface reads; http: door `clock`, frozen) to `ms`. */
  clockTo(ms: Ms): Promise<void>;
  /** The window of `eventId` is recorded `healthy` (http: samples through the window via doors `clock` + `presence/tick`; sim: nothing to do). */
  markHealthy(eventId: string): Promise<void>;
  /** The rating closes: the clock moves to the close instant. */
  closeRating(): Promise<void>;
  /** `svc`'s subject is present at the event at the current clock (sim: a page surface ticks; http: `beat`). */
  present(svc: PassportService, eventId: string): Promise<void>;
  /** The adapter has the `beat` primitive (sim does not: it tracks surfaces locally). */
  hasBeat: boolean;
  /** `granted` reaches `subscribe` listeners (http needs a realtime transport the contract run does not have). */
  pushesGranted: boolean;
  /** The current site clock, for the `at` of a claim. */
  now(): Ms;
}

type Res<T> = { ok: true; value: T } | { ok: false; error: { code: string; reason?: string } };

async function unwrap<T>(p: Promise<Res<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}/${r.error.reason ?? ''}`);
  return r.value;
}

/** One behaviour suite for the `passport` domain (SPEC-14 AC-61), run on sim and http. */
export function describeDomain(
  name: string,
  makeService: () => PassportService,
  ctx: PassportSuiteCtx,
): void {
  describe(name, () => {
    it('a new subject has no stamps', async () => {
      expect(await unwrap(makeService().stamps())).toEqual([]);
    });

    it('beat answers when to send the next one (a number or null)', async (t) => {
      if (!ctx.hasBeat) return t.skip();
      const { eventId, momentMs } = ctx.event();
      await ctx.clockTo(momentMs - 120_000);
      const r = await unwrap(
        makeService().beat({ eventIds: [eventId], source: 'tv', openedAt: ctx.now() }),
      );
      expect(r.nextBeatMs === null || (Number.isInteger(r.nextBeatMs) && r.nextBeatMs > 0)).toBe(
        true,
      );
    });

    it('presence, then a claim after m + 15 s → the stamp; a repeat returns the same stamp and the list holds one', async () => {
      const svc = makeService();
      const { eventId, momentMs } = ctx.event();
      await ctx.clockTo(momentMs - 1_000);
      await ctx.present(svc, eventId);
      await ctx.clockTo(momentMs + 16_000);
      const first = await unwrap(svc.claim({ eventId, source: 'tv', at: ctx.now() }));
      expect(first.eventId).toBe(eventId);
      expect(first.countryIso).toMatch(/^[A-Z]{2}$/);
      expect(first.cityName.length).toBeGreaterThan(0);
      expect(first.grantedAt).toBe(momentMs + 15_000);
      await ctx.clockTo(momentMs + 60_000);
      const again = await unwrap(svc.claim({ eventId, source: 'tv', at: ctx.now() }));
      expect(again).toEqual(first);
      expect(await unwrap(svc.stamps())).toEqual([first]);
    });

    it(
      'a healthy window and no presence → forbidden / no-presence; nothing is stamped',
      { timeout: 180_000 },
      async () => {
        const svc = makeService();
        const { eventId, momentMs } = ctx.event();
        await ctx.markHealthy(eventId);
        await ctx.clockTo(momentMs + 30_000);
        expect(await svc.claim({ eventId, source: 'tv', at: ctx.now() })).toMatchObject({
          ok: false,
          error: { code: 'forbidden', reason: 'no-presence' },
        });
        expect(await unwrap(svc.stamps())).toEqual([]);
      },
    );

    it('an unknown event → not_found / unknown-event', async () => {
      const { momentMs } = ctx.event();
      await ctx.clockTo(momentMs + 30_000);
      expect(
        await makeService().claim({ eventId: 'no-such-event', source: 'tv', at: ctx.now() }),
      ).toMatchObject({
        ok: false,
        error: { code: 'not_found', reason: 'unknown-event' },
      });
    });

    it('after the rating closes a new claim → conflict / claim-closed', async () => {
      const svc = makeService();
      const { eventId } = ctx.event();
      await ctx.closeRating();
      expect(await svc.claim({ eventId, source: 'tv', at: ctx.now() })).toMatchObject({
        ok: false,
        error: { code: 'conflict', reason: 'claim-closed' },
      });
    });

    it('subscribe: a granted stamp arrives as a `granted` event', async (t) => {
      if (!ctx.pushesGranted) return t.skip();
      const svc = makeService();
      const { eventId, momentMs } = ctx.event();
      const events: PassportEvent[] = [];
      const off = svc.subscribe((e) => events.push(e));
      await ctx.clockTo(momentMs - 1_000);
      await ctx.present(svc, eventId);
      await ctx.clockTo(momentMs + 16_000);
      const stamp = await unwrap(svc.claim({ eventId, source: 'tv', at: ctx.now() }));
      off();
      expect(events).toEqual([{ type: 'granted', stamp }]);
    });
  });
}
