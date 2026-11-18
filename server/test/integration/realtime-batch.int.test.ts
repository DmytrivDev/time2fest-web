/**
 * SPEC-06 batching against the shared Centrifugo (AC-37, AC-38, AC-40, NFR-5): a publisher of the test
 * registry over the real API adapter (wrapped to record publish times), an anonymous `rttest`
 * subscriber, and for AC-40 a local fake API on port 4124 that answers 503 to the first publish and
 * proxies the rest. Skips with a line naming Centrifugo when it is unreachable (AC-62).
 * The API key, the token secret and tokens are never printed.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { RealtimeBatch, RealtimeEnvelope } from '@time2fest/contracts';
import type { Centrifuge, PublicationContext } from 'centrifuge';
import { afterAll, expect, it } from 'vitest';
import { createCentrifugoApi } from '../../src/adapters/centrifugoApi';
import type { Logger } from '../../src/ports';
import { BATCH_MIN_GAP_MS } from '../../src/realtime/batcher';
import type { CentrifugoApi, Scheduler } from '../../src/realtime/ports';
import { createChannelPublisher, type BatchingChannelPublisher } from '../../src/realtime/publisher';
import { channelClassesFor } from '../../src/registries/channels';
import { centrifugeClient, connectAndWait, describeRealtime, name, realtimeEnv } from './realtime-support';

/** This slot's fake API port (nothing else listens there while this file runs). */
const FAKE_API_PORT = 4124;
const rows = channelClassesFor('test');

const lines: { level: string; fields: Record<string, unknown> }[] = [];
const capture: Logger = {
  info: (fields) => lines.push({ level: 'info', fields }),
  warn: (fields) => lines.push({ level: 'warn', fields }),
  error: (fields) => lines.push({ level: 'error', fields }),
};
const timers: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const clock = { now: () => performance.now() };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = (p: string) => `${p}${randomBytes(5).toString('hex')}`;
const ev = (n: number): RealtimeEnvelope => ({ type: 'rt.test', id: uid('ev_'), data: { n } });

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (pred()) return true;
    await sleep(20);
  }
  return pred();
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? NaN;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0] ?? NaN, median: quantile(s, 0.5), p95: quantile(s, 0.95), max: s.at(-1) ?? NaN };
};
const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));

const clients: Centrifuge[] = [];
const publishers: BatchingChannelPublisher[] = [];

/** A batching publisher of the test registry over `api`; stopped after the file. */
function publisherOver(api: CentrifugoApi): BatchingChannelPublisher {
  const p = createChannelPublisher({ api, rows, prefix: realtimeEnv.prefix, log: capture, scheduler: timers, clock, makeId: () => randomUUID() });
  publishers.push(p);
  return p;
}

/** The real API adapter, wrapped to record when each publish call leaves the publisher. */
function recordingApi(url = realtimeEnv.url ?? ''): { api: CentrifugoApi; times: number[] } {
  const real = createCentrifugoApi({ url, apiKey: realtimeEnv.apiKey ?? '', log: capture });
  const times: number[] = [];
  return {
    times,
    api: {
      publish: (input) => {
        times.push(performance.now());
        return real.publish(input);
      },
      disconnectUser: (...args) => real.disconnectUser(...args),
    },
  };
}

/** An anonymous subscriber of `rttest:<prefix><channel>`, collecting each publication with its arrival time. */
async function subscriber(channel: string): Promise<{ got: { at: number; batch: RealtimeBatch }[] }> {
  const client = centrifugeClient(null);
  clients.push(client);
  expect(await connectAndWait(client)).toBe('connected');
  const got: { at: number; batch: RealtimeBatch }[] = [];
  const sub = client.newSubscription(name('rttest', channel));
  sub.on('publication', (ctx: PublicationContext) => got.push({ at: performance.now(), batch: ctx.data as RealtimeBatch }));
  const subscribed = new Promise<void>((resolve) => sub.once('subscribed', () => resolve()));
  sub.subscribe();
  await subscribed;
  return { got };
}

const countersOf = (got: { batch: RealtimeBatch }[]) => got.flatMap((g) => g.batch.events.map((e) => (e.data as { n: number }).n));

afterAll(async () => {
  for (const p of publishers) p.stop();
  for (const c of clients) c.disconnect();
});

describeRealtime('batched publish against Centrifugo', () => {
  it('AC-37: 20 events/s for 60 s → publisher and subscriber intervals within [250; 500] ms', { timeout: 120_000 }, async () => {
    const channel = uid('batch_');
    const { got } = await subscriber(channel);
    const { api, times } = recordingApi();
    const publisher = publisherOver(api);

    const t0 = performance.now();
    const total = 20 * 60;
    for (let i = 0; i < total; i += 1) {
      // Drift-free pacing: event i leaves at t0 + 50·i ms.
      const wait = t0 + i * 50 - performance.now();
      if (wait > 0) await sleep(wait);
      expect(await publisher.publish('rttest', channel, ev(i))).toEqual({ status: 'queued' });
    }
    expect(await waitFor(() => countersOf(got).length >= total, 5_000)).toBe(true);
    await publisher.idle();

    const pubGaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    const subGaps = got.slice(1).map((g, i) => g.at - (got[i]?.at ?? 0));
    const pub = stats(pubGaps);
    const sub = stats(subGaps);
    // Measured spacing for the run report.
    console.log(`[AC-37] publisher gaps ms ${JSON.stringify(round(pub))}; subscriber gaps ms ${JSON.stringify(round(sub))}`);

    expect(pub.n).toBeGreaterThan(100);
    expect(pub.min).toBeGreaterThanOrEqual(BATCH_MIN_GAP_MS);
    expect(pub.max).toBeLessThanOrEqual(500);
    expect(sub.p95).toBeGreaterThanOrEqual(250);
    expect(sub.p95).toBeLessThanOrEqual(500);
    expect(countersOf(got)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(lines.filter((l) => l.level === 'warn')).toEqual([]);
  });

  it('AC-38: 1 000 events with a rising counter over several flushes and batches arrive in order', { timeout: 30_000 }, async () => {
    const channel = uid('order_');
    const { got } = await subscriber(channel);
    const { api, times } = recordingApi();
    const publisher = publisherOver(api);

    let n = 0;
    // Bursts of 250 every 100 ms: a flush holds more than 200 events, so it splits, and several flushes follow.
    for (let burst = 0; burst < 4; burst += 1) {
      for (let i = 0; i < 250; i += 1) expect((await publisher.publish('rttest', channel, ev(n++))).status).toBe('queued');
      await sleep(100);
    }
    expect(await waitFor(() => countersOf(got).length >= 1_000, 10_000)).toBe(true);
    await publisher.idle();
    // At least 5 publications (≤200 events each), spread over more than one flush.
    expect(times.length).toBeGreaterThanOrEqual(5);
    expect(times.at(-1)! - times[0]!).toBeGreaterThanOrEqual(BATCH_MIN_GAP_MS);
    expect(got.some((g) => g.batch.events.length === 200)).toBe(true);
    expect(countersOf(got)).toEqual(Array.from({ length: 1_000 }, (_, i) => i));
  });

  it('AC-40, NFR-5: a 503 on the first publish drops that batch with a warn line; the next batch is delivered', { timeout: 30_000 }, async () => {
    let publishCalls = 0;
    const fake: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        if (req.url === '/api/publish' && (publishCalls += 1) === 1) {
          res.writeHead(503).end();
          return;
        }
        fetch(`${realtimeEnv.url}${req.url ?? ''}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': String(req.headers['x-api-key'] ?? '') },
          body: Buffer.concat(chunks),
        })
          .then(async (up) => res.writeHead(up.status, { 'content-type': 'application/json' }).end(Buffer.from(await up.arrayBuffer())))
          .catch(() => res.writeHead(502).end());
      });
    });
    await new Promise<void>((resolve, reject) => {
      fake.once('error', reject);
      fake.listen(FAKE_API_PORT, '127.0.0.1', () => resolve());
    });
    try {
      const channel = uid('fail_');
      const { got } = await subscriber(channel);
      const publisher = publisherOver(recordingApi(`http://127.0.0.1:${FAKE_API_PORT}`).api);
      const from = lines.length;

      const lost = [ev(0), ev(1)];
      for (const e of lost) expect((await publisher.publish('rttest', channel, e)).status).toBe('queued');
      await sleep(400);
      await publisher.idle();
      expect(lines.slice(from)).toEqual([{ level: 'warn', fields: { event: 'realtime_publish', class: 'rttest', events: 2, result: 'unavailable' } }]);

      const next = ev(2);
      expect((await publisher.publish('rttest', channel, next)).status).toBe('queued');
      expect(await waitFor(() => got.some((g) => g.batch.events.some((e) => e.id === next.id)), 2_000)).toBe(true);
      await sleep(300);
      const ids = got.flatMap((g) => g.batch.events.map((e) => e.id));
      expect(ids).toEqual([next.id]);
      expect(publishCalls).toBe(2);
      expect(lines.slice(from)).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });
});
