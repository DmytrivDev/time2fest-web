/**
 * Spike 6 (SPEC-08 AC-37): 50 sequential site changes under 20 parallel snapshot readers against the `_test`
 * database. A read that STARTS after an event of version v has arrived never returns a lower version, and
 * the fan-out never publishes a version lower than one it already published (events arrive in order).
 * Reads go through the snapshot reader the public route serves (`readSnapshot`), outside any transaction.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { emptyProducts } from '../../src/adapters/products';
import { createPayloadSiteStore } from '../../src/adapters/payloadSiteState';
import { eventsOf, payloadOf, siteFanOutDepsOf, startBackground } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import type { EventBus } from '../../src/events/bus';
import { createSiteFanOutSubscribers, settleFanOuts, type FanOutDeps } from '../../src/site/fanout';
import { toggle, type SiteDeps } from '../../src/site/service';
import { readSnapshot } from '../../src/site/snapshot';
import { createTinyCatalog, removeTinyCatalog } from './catalog-helpers';
import { silent, testDeps } from './helpers';
import { note } from './measure';

const run = `sc${Date.now()}`;
const OWNER = { kind: 'owner' as const, id: 'site-concurrency', label: 'site-concurrency@test' };
const CHANGES = 50;
const READERS = 20;

let deps: Deps;
let payload: Payload;
let site: SiteDeps;
let fan: FanOutDeps;
let bus: EventBus;
/** The highest version an event has delivered so far, and every delivered version in arrival order. */
let arrived = 0;
const arrivals: number[] = [];

beforeAll(async () => {
  deps = testDeps({ log: silent });
  payload = await payloadOf(deps)();
  await createTinyCatalog(payload, run);
  const store = createPayloadSiteStore({ payload: payloadOf(deps), clock: deps.clock });
  site = { store, products: emptyProducts, journal: createPayloadJournal(() => true), publisher: eventsOf(deps).publisher, clock: deps.clock };
  const real = siteFanOutDepsOf(deps);
  fan = {
    snapshot: real.snapshot,
    claim: real.claim,
    publisher: {
      async publish(_classKey, _key, envelope) {
        const v = envelope.version ?? 0;
        arrivals.push(v);
        arrived = Math.max(arrived, v);
        return { status: 'ok' };
      },
    },
    alarm: { raise: () => {} },
    log: silent,
    sleep: async () => {},
  };
  bus = await startBackground(deps, createSiteFanOutSubscribers(async () => fan));
});

afterAll(async () => {
  await bus?.stop();
  await settleFanOuts();
  if (payload) await removeTinyCatalog(payload, run);
});

describe('site snapshot under concurrent changes and reads (spike 6)', () => {
  it(`AC-37: ${CHANGES} sequential changes, ${READERS} parallel readers — no read after an event returns a lower version`, { timeout: 180_000 }, async () => {
    const violations: { floor: number; read: number }[] = [];
    let reads = 0;
    let done = false;

    const reader = async () => {
      while (!done) {
        const floor = arrived;
        const snapshot = await readSnapshot(fan.snapshot);
        reads += 1;
        if (!snapshot.ok) throw new Error('snapshot unavailable');
        if (snapshot.state.version < floor) violations.push({ floor, read: snapshot.state.version });
      }
    };

    const writer = async () => {
      try {
        let last = 0;
        for (let i = 0; i < CHANGES; i += 1) {
          const record = await site.store.read();
          const result = await toggle(site, null, OWNER, { key: 'passOffer', value: !record.switches.passOffer, reason: `spike 6 #${i}` }, 'manual');
          if (!result.ok || !result.changed) throw new Error(`toggle refused: ${JSON.stringify(result)}`);
          expect(result.version).toBeGreaterThan(last);
          last = result.version;
        }
        // Let the last events arrive while the readers still run.
        const end = performance.now() + 5_000;
        while (arrived < last && performance.now() < end) await new Promise((r) => setTimeout(r, 20));
        return last;
      } finally {
        done = true;
      }
    };

    const [last] = await Promise.all([writer(), ...Array.from({ length: READERS }, reader)]);
    await settleFanOuts();
    note(`site-concurrency: ${CHANGES} changes, ${reads} reads, ${arrivals.length} events, last version ${String(last)}`);

    expect(violations).toEqual([]);
    expect(arrived).toBe(last);
    // Events are fanned out in increasing version order, each version at most once.
    for (let i = 1; i < arrivals.length; i += 1) expect(arrivals[i]).toBeGreaterThan(arrivals[i - 1] as number);
    expect(arrivals.length).toBeGreaterThan(0);
    expect(reads).toBeGreaterThan(READERS);
  });
});
