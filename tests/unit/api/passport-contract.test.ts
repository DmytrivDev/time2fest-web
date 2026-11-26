import { afterEach, beforeEach } from 'vitest';
import type { PresenceClock } from '@/lib/api/contracts/passport';
import { createSimPassport } from '@/lib/api/sim/passport';
import { patchedData } from '@/lib/api/hooks/site';
import { getData } from '@/lib/data/load';
import { clearPresenceRegistry } from '@/lib/presence/surfaces';
import { useGuestStore } from '@/stores/guest';
import { ratingCloseAt } from '@time2fest/rules/time';
import { describeDomain, type PassportSuiteCtx } from '../../contract/passport.suite';

const london = getData().events.find((e) => e.cityId.includes('london')) ?? getData().events[0]!;

let t = 0;
const subs = new Set<() => void>();
const clock: PresenceClock = {
  now: () => t,
  fallbackNow: () => t,
  subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)),
};

beforeEach(() => {
  useGuestStore.getState().resetGuest();
  clearPresenceRegistry();
  subs.clear();
  t = london.midnightMs - 60_000;
});
afterEach(() => clearPresenceRegistry());

const ctx: PassportSuiteCtx = {
  event: () => ({ eventId: london.id, momentMs: london.midnightMs }),
  async clockTo(ms) {
    t = ms;
    subs.forEach((cb) => cb());
  },
  // The sim has no health records: a claim without a presence surface is refused outright.
  async markHealthy() {},
  async closeRating() {
    t = ratingCloseAt(patchedData());
  },
  async present(svc, eventId) {
    // The page opened a minute before: the surface counts as present at midnight (as in passport-sim.test).
    svc.trackPresence(
      { source: 'tv', eventIds: [eventId], openedAt: new Map([[eventId, t - 60_000]]) },
      clock,
    );
  },
  hasBeat: false, // the sim tracks surfaces locally and sends no beats
  pushesGranted: true,
  now: () => t,
};

describeDomain('passport (sim)', () => createSimPassport(), ctx);
