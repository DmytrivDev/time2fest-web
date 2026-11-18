/**
 * SPEC-06 batching without Centrifugo: the split rule (AC-39), the flush window and spacing (AC-37),
 * order across flushes (AC-38), drop-and-continue with a warn line (AC-40, NFR-5) and the batcher's
 * lifecycle. A manual scheduler and clock replace real timers.
 */
import type { RealtimeBatch, RealtimeEnvelope } from '@time2fest/contracts';
import { RealtimeBatchSchema } from '@time2fest/contracts/schemas';
import { describe, expect, it } from 'vitest';
import { batchOverheadBytes, jsonBytes, splitBatch } from '../../src/domain/realtime/batch';
import { BATCH_MIN_GAP_MS, BATCH_WINDOW_MS } from '../../src/realtime/batcher';
import type { CentrifugoApi, CentrifugoPublishInput, PublishOutcome, Scheduler } from '../../src/realtime/ports';
import { createChannelPublisher } from '../../src/realtime/publisher';
import { channelClassesFor } from '../../src/registries/channels';

const PREFIX = 'unit_test_';
const CHANNEL = `rttest:${PREFIX}b`;
const rows = channelClassesFor('test');

type Line = { level: 'info' | 'warn' | 'error'; fields: Record<string, unknown> };

/** A scheduler and clock on virtual time; `advance` fires due timers in order and lets their promises settle. */
function manualTime() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const scheduler: Scheduler = {
    setTimeout: (fn, ms) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    clock: { now: () => now },
    scheduler,
    pending: () => timers.size,
    async advance(ms: number): Promise<void> {
      const end = now + ms;
      await settle();
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (next === undefined || next[1].at > end) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

/** A stub API that records each publish with its virtual time; `outcomes` are answered in turn, then `ok`. */
function recordingApi(time: { clock: { now(): number } }, outcomes: PublishOutcome[] = []) {
  const calls: { at: number; input: CentrifugoPublishInput }[] = [];
  let gate: Promise<void> | undefined;
  const api: CentrifugoApi = {
    publish: async (input) => {
      calls.push({ at: time.clock.now(), input });
      if (gate) await gate;
      return outcomes.shift() ?? { status: 'ok', offset: calls.length, epoch: 'e' };
    },
    disconnectUser: () => Promise.resolve('ok'),
  };
  return {
    api,
    calls,
    /** Holds every publish until the returned function is called. */
    hold(): () => void {
      let release = () => {};
      gate = new Promise<void>((resolve) => (release = resolve));
      return () => {
        gate = undefined;
        release();
      };
    },
  };
}

function setup(outcomes: PublishOutcome[] = []) {
  const time = manualTime();
  const rec = recordingApi(time, outcomes);
  const lines: Line[] = [];
  const log = {
    info: (fields: Record<string, unknown>) => lines.push({ level: 'info', fields }),
    warn: (fields: Record<string, unknown>) => lines.push({ level: 'warn', fields }),
    error: (fields: Record<string, unknown>) => lines.push({ level: 'error', fields }),
  };
  let n = 0;
  const makeId = () => `b_${String((n += 1)).padStart(34, '0')}`;
  const publisher = createChannelPublisher({ api: rec.api, rows, prefix: PREFIX, log, scheduler: time.scheduler, clock: time.clock, makeId });
  return { time, rec, lines, publisher };
}

const ev = (i: number, data: unknown = { n: i }): RealtimeEnvelope => ({ type: 'rt.test', id: `e${i}`, data });
const batchOf = (input: CentrifugoPublishInput) => input.data as RealtimeBatch;
const idsOf = (calls: { input: CentrifugoPublishInput }[]) => calls.flatMap((c) => batchOf(c.input).events.map((e) => e.id));

describe('splitBatch (AC-39)', () => {
  let n = 0;
  const makeId = () => `id${(n += 1)}`;

  it('no events → no batch; 200 events → one batch; 201 → two, in order', () => {
    expect(splitBatch([], makeId)).toEqual([]);
    const two = Array.from({ length: 201 }, (_, i) => ev(i));
    expect(splitBatch(two.slice(0, 200), makeId).map((b) => b.events.length)).toEqual([200]);
    const split = splitBatch(two, makeId);
    expect(split.map((b) => b.events.length)).toEqual([200, 1]);
    expect(split.flatMap((b) => b.events)).toEqual(two);
  });

  it('splits by serialized size: every batch ≤ 65 536 bytes, the next starts only when an event does not fit', () => {
    const big = Array.from({ length: 10 }, (_, i) => ev(i, 'x'.repeat(20_000)));
    const split = splitBatch(big, makeId);
    expect(split.map((b) => b.events.length)).toEqual([3, 3, 3, 1]);
    for (const b of split) expect(jsonBytes(b)).toBeLessThanOrEqual(65_536);
    expect(split.flatMap((b) => b.events)).toEqual(big);
    // The size bound is exact: a batch of exactly the limit is one batch.
    const id = 'fixed';
    const exact = ev(0, '');
    const pad = 65_536 - batchOverheadBytes(id) - jsonBytes(exact);
    const full = ev(0, 'y'.repeat(pad));
    expect(jsonBytes(splitBatch([full], () => id)[0])).toBe(65_536);
  });
});

describe('batched publish (AC-37 … AC-40)', () => {
  it('AC-39: 450 events in one window → 3 publications in order, each valid C3 and ≤ 65 536 bytes', async () => {
    const { time, rec, publisher } = setup();
    const events = Array.from({ length: 450 }, (_, i) => ev(i));
    for (const e of events) expect(await publisher.publish('rttest', 'b', e)).toEqual({ status: 'queued' });
    expect(rec.calls).toHaveLength(0);
    await time.advance(BATCH_WINDOW_MS);
    expect(rec.calls.map((c) => batchOf(c.input).events.length)).toEqual([200, 200, 50]);
    expect(idsOf(rec.calls)).toEqual(events.map((e) => e.id));
    for (const { input } of rec.calls) {
      expect(input.channel).toBe(CHANNEL);
      expect(input.idempotencyKey).toBe(batchOf(input).id);
      expect(RealtimeBatchSchema.safeParse(input.data).success).toBe(true);
      expect(jsonBytes(input.data)).toBeLessThanOrEqual(65_536);
    }
  });

  it('AC-37: the first event waits exactly 300 ms; at 20 events/s adjacent flushes are 250–500 ms apart', async () => {
    const { time, rec, publisher } = setup();
    await publisher.publish('rttest', 'b', ev(0));
    await time.advance(BATCH_WINDOW_MS - 1);
    expect(rec.calls).toHaveLength(0);
    await time.advance(1);
    expect(rec.calls.map((c) => c.at)).toEqual([300]);
    for (let i = 1; i <= 100; i += 1) {
      await time.advance(50);
      await publisher.publish('rttest', 'b', ev(i));
    }
    await time.advance(1_000);
    const gaps = rec.calls.slice(1).map((c, i) => c.at - (rec.calls[i]?.at ?? 0));
    expect(gaps.length).toBeGreaterThan(10);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(BATCH_MIN_GAP_MS);
      expect(gap).toBeLessThanOrEqual(500);
    }
    expect(idsOf(rec.calls)).toEqual(Array.from({ length: 101 }, (_, i) => `e${i}`));
  });

  it('AC-38: a slow flush delays the next one; order holds across the batch boundary and the gap stays ≥ 250 ms', async () => {
    const { time, rec, publisher } = setup();
    const release = rec.hold();
    await publisher.publish('rttest', 'b', ev(0));
    await time.advance(300);
    expect(rec.calls).toHaveLength(1);
    await publisher.publish('rttest', 'b', ev(1));
    await publisher.publish('rttest', 'b', ev(2));
    await time.advance(700);
    // Still one call: the next flush waits for the running one.
    expect(rec.calls).toHaveLength(1);
    release();
    await time.advance(0);
    await time.advance(BATCH_WINDOW_MS);
    expect(rec.calls).toHaveLength(2);
    expect((rec.calls[1]?.at ?? 0) - (rec.calls[0]?.at ?? 0)).toBeGreaterThanOrEqual(BATCH_MIN_GAP_MS);
    expect(idsOf(rec.calls)).toEqual(['e0', 'e1', 'e2']);
  });

  it('channels are independent: each has its own window', async () => {
    const { time, rec, publisher } = setup();
    await publisher.publish('rttest', 'b', ev(0));
    await time.advance(100);
    await publisher.publish('rttest', 'c', ev(1));
    await time.advance(200);
    expect(rec.calls.map((c) => [c.input.channel, c.at])).toEqual([[CHANNEL, 300]]);
    await time.advance(100);
    expect(rec.calls.map((c) => [c.input.channel, c.at])).toEqual([
      [CHANNEL, 300],
      [`rttest:${PREFIX}c`, 400],
    ]);
  });

  it('AC-40, NFR-5: a failed batch is dropped with one warn line (class, events, result, no body); the next window publishes', async () => {
    const { time, rec, lines, publisher } = setup([{ status: 'unavailable' }, { status: 'rejected', code: 102 }]);
    for (const i of [0, 1, 2]) await publisher.publish('rttest', 'b', ev(i, { secretish: 'body-marker' }));
    await time.advance(300);
    expect(lines).toEqual([{ level: 'warn', fields: { event: 'realtime_publish', class: 'rttest', events: 3, result: 'unavailable' } }]);
    await publisher.publish('rttest', 'b', ev(3));
    await time.advance(300);
    expect(lines[1]).toEqual({ level: 'warn', fields: { event: 'realtime_publish', class: 'rttest', events: 1, result: 'unavailable', apiCode: 102 } });
    await publisher.publish('rttest', 'b', ev(4));
    await time.advance(300);
    expect(rec.calls).toHaveLength(3);
    expect(lines).toHaveLength(2);
    expect(batchOf(rec.calls[2]!.input).events.map((e) => e.id)).toEqual(['e4']);
    expect(JSON.stringify(lines)).not.toContain('body-marker');
  });

  it('a throwing API never reaches domain code and the schedule continues', async () => {
    const time = manualTime();
    let calls = 0;
    const api: CentrifugoApi = {
      publish: () => ((calls += 1), calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ status: 'ok' })),
      disconnectUser: () => Promise.resolve('ok'),
    };
    const warns: unknown[] = [];
    const log = { info: () => {}, warn: (f: unknown) => warns.push(f), error: () => {} };
    const publisher = createChannelPublisher({ api, rows, prefix: PREFIX, log, scheduler: time.scheduler, clock: time.clock, makeId: () => 'id' });
    await publisher.publish('rttest', 'b', ev(0));
    await time.advance(300);
    await publisher.publish('rttest', 'b', ev(1));
    await time.advance(300);
    expect(calls).toBe(2);
    expect(warns).toHaveLength(1);
  });

  it('AC-31: a batched event that cannot fit a batch on its own → validation, nothing queued', async () => {
    const { time, rec, publisher } = setup();
    const base = jsonBytes(ev(0, ''));
    // Fits the single-publication limit, but not with the batch wrapper around it.
    const tooBig = ev(0, 'z'.repeat(65_536 - base));
    expect(jsonBytes(tooBig)).toBe(65_536);
    expect(await publisher.publish('rttest', 'b', tooBig)).toEqual({ status: 'validation' });
    await time.advance(1_000);
    expect(rec.calls).toHaveLength(0);
    expect(time.pending()).toBe(0);
  });

  it('the queued envelope is a snapshot: a later change by the caller is not published', async () => {
    const { time, rec, publisher } = setup();
    const e = ev(0, { n: 1 });
    await publisher.publish('rttest', 'b', e);
    (e.data as { n: number }).n = 2;
    await time.advance(300);
    expect(batchOf(rec.calls[0]!.input).events[0]?.data).toEqual({ n: 1 });
  });

  it('stop() clears every timer and drops the queue; later batched publishes are unavailable; idle() resolves', async () => {
    const { time, rec, publisher, lines } = setup();
    await publisher.publish('rttest', 'b', ev(0));
    await publisher.publish('rttest', 'c', ev(1));
    expect(time.pending()).toBe(2);
    publisher.stop();
    expect(time.pending()).toBe(0);
    await time.advance(1_000);
    expect(rec.calls).toHaveLength(0);
    expect(await publisher.publish('rttest', 'b', ev(2))).toEqual({ status: 'unavailable' });
    expect(lines.at(-1)?.fields).toEqual({ event: 'realtime_publish', class: 'rttest', events: 1, result: 'unavailable' });
    await expect(publisher.idle()).resolves.toBeUndefined();
  });

  it('an unbatched class keeps the immediate path', async () => {
    const { rec, publisher } = setup();
    expect(await publisher.publish('site:state', undefined, ev(0))).toEqual({ status: 'ok', offset: 1, epoch: 'e' });
    expect(rec.calls[0]?.input.data).toEqual(ev(0));
  });
});
