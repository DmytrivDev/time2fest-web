/**
 * Internal events (AC-40 … AC-42), one process: an event published inside a committed
 * transaction reaches the test subscriber ≤ 2 s after the commit with a growing version; a rolled
 * back one never arrives; the read port gives the latest version of a topic. The two-instance proof
 * is `test/exclusive/events-two-instances.exclusive.test.ts` (W53).
 */
import { commitTransaction, createLocalReq, initTransaction, killTransaction, type Payload, type PayloadRequest } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsOf, payloadOf, startBackground } from '../../src/container';
import type { EventBus } from '../../src/events/bus';
import type { Deps } from '../../src/endpoints/types';
import { recordedEvents } from '../../src/registries/subscribers';
import { testDeps } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

describe('internal events (AC-40 … AC-42)', () => {
  let deps: Deps;
  let payload: Payload;
  let bus: EventBus;
  const run = `${Date.now()}`;

  async function inTransaction(fn: (req: PayloadRequest) => Promise<void>, outcome: 'commit' | 'rollback'): Promise<void> {
    const req = await createLocalReq({}, payload);
    await initTransaction(req);
    await fn(req);
    if (outcome === 'commit') await commitTransaction(req);
    else await killTransaction(req);
  }

  const seen = (topic: string) => recordedEvents().filter((e) => e.topic === topic);

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    bus = await startBackground(deps);
  });

  afterAll(async () => {
    await bus.stop();
  });

  it('a committed event reaches the subscriber within 2 s, with an increasing version', async () => {
    const topic = `test.commit.${run}`;
    const { publisher } = eventsOf(deps);
    for (const n of [1, 2]) {
      await inTransaction(async (req) => {
        await publisher.publish(req, topic, { n });
      }, 'commit');
      const committed = Date.now();
      expect(await waitFor(() => seen(topic).length === n, 2_000)).toBe(true);
      expect(Date.now() - committed).toBeLessThanOrEqual(2_000);
    }
    const [first, second] = seen(topic);
    expect(first?.version).toBe(1);
    expect(second?.version).toBe(2);
    expect(second?.payload).toEqual({ n: 2 });
    expect(Number(second?.id)).toBeGreaterThan(Number(first?.id));
  });

  it('AC-41: an event of a rolled-back transaction is never delivered (3 s)', async () => {
    const topic = `test.rollback.${run}`;
    await inTransaction(async (req) => {
      await eventsOf(deps).publisher.publish(req, topic, { lost: true });
    }, 'rollback');
    await sleep(3_000);
    expect(seen(topic)).toHaveLength(0);
    expect(await eventsOf(deps).log.latest(topic)).toBeNull();
  });

  it('AC-42: after three publishes the read port gives the third version and its value', async () => {
    const topic = `test.state.${run}`;
    for (const n of [1, 2, 3]) {
      await inTransaction(async (req) => {
        await eventsOf(deps).publisher.publish(req, topic, { n });
      }, 'commit');
    }
    const latest = await eventsOf(deps).log.latest(topic);
    expect(latest).toMatchObject({ topic, version: 3, payload: { n: 3 } });
  });
});
