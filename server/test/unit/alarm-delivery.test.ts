/**
 * SPEC-13b W12/W13: the delivering alarm and the Telegram sender over in-memory ports.
 * AC-1 (stdout line as before, never throws), AC-2 (outbox row), AC-5 (no recursion, one failure alarm),
 * AC-6 (repeats on a pending row too), AC-7 (storm summary), AC-9 (direct send once per 10 min), AC-11, AC-12, AC-27.
 * The Postgres outbox, the lease and the real process paths are in `alarm-delivery.int.test.ts` and the exclusive files.
 */
import { describe, expect, it } from 'vitest';
import { createDeliveringAlarm, DIRECT_SEND_WINDOW_MS } from '../../src/alarms/delivery';
import type { AlarmDeliveryOutcome, AlarmDetails, AlarmMessage, AlarmSink } from '../../src/alarms/ports';
import { createSender } from '../../src/alarms/sender';
import { createAlarm } from '../../src/platform/logger';
import type { AlarmInput, Logger } from '../../src/ports';
import type { NewOutboxRow, OpsLease, Outbox, OutboxKind, OutboxRow } from '../../src/ops/ports';

const PAGE: AlarmInput = { level: 'page', source: 'catalog', code: 'catalog-r2-copy-failed', details: { attempts: 3, email: 'a@b.c' } };
const SECRET = 'test-telegram-token-not-real'; // check-secrets: allow test fake
const CHAT = '-1000000000042';
const T0 = Date.UTC(2026, 11, 31, 21, 0, 0);
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => {
  for (let i = 0; i < n; i += 1) await flush();
};

function captureLog(): { lines: Record<string, unknown>[]; log: Logger } {
  const lines: Record<string, unknown>[] = [];
  const push = (f: Record<string, unknown>) => void lines.push(f);
  return { lines, log: { info: push, warn: push, error: push } };
}

/** In-memory outbox with the adapter's semantics. */
function memoryOutbox(): Outbox & { rows: OutboxRow[]; failInsert: boolean; hang: boolean } {
  const rows: OutboxRow[] = [];
  let seq = 0;
  const find = (id: string) => rows.find((r) => r.id === id);
  const self = {
    rows,
    failInsert: false,
    hang: false,
    async insert(row: NewOutboxRow) {
      if (self.hang) return new Promise<never>(() => {});
      if (self.failInsert) throw new Error('postgres down');
      if (row.slotKey && rows.some((r) => r.slotKey === row.slotKey)) return 'duplicate-slot' as const;
      seq += 1;
      rows.push({ ...row, id: String(seq), status: 'pending', attempts: 0, nextAttemptAt: row.notBefore ?? row.createdAt, deliveredAt: null, failedAt: null, repeatCount: 0 });
      return { id: String(seq) };
    },
    async claimDue(limit: number, now: number, kinds?: readonly OutboxKind[]) {
      const due = rows
        .filter((r) => r.status === 'pending' && r.nextAttemptAt <= now && (!kinds || kinds.includes(r.kind)))
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit);
      for (const r of due) r.nextAttemptAt = now + 30_000;
      return due.map((r) => ({ ...r }));
    },
    async markDelivered(id: string, at: number) {
      const r = find(id)!;
      Object.assign(r, { status: 'delivered', deliveredAt: at, attempts: r.attempts + 1 });
    },
    async markRetry(id: string, nextAt: number) {
      const r = find(id)!;
      Object.assign(r, { nextAttemptAt: nextAt, attempts: r.attempts + 1 });
    },
    async markFailed(id: string, at: number) {
      const r = find(id)!;
      Object.assign(r, { status: 'failed', failedAt: at, attempts: r.attempts + 1 });
    },
    async latestDeliveredOfKind(kind: { source: string; code: string }, sinceMs: number) {
      const hit = rows
        .filter((r) => r.kind === 'alarm' && r.status === 'delivered' && r.alarm?.source === kind.source && r.alarm.code === kind.code && (r.deliveredAt ?? 0) >= sinceMs)
        .sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0))[0];
      return hit ? { ...hit } : null;
    },
    async pendingOfKind(kind: { source: string; code: string }) {
      const hit = rows.filter((r) => r.kind === 'alarm' && r.status === 'pending' && r.alarm?.source === kind.source && r.alarm.code === kind.code).at(-1);
      return hit ? { ...hit } : null;
    },
    async incrementRepeat(id: string, by = 1) {
      find(id)!.repeatCount += by;
    },
    async countSent(sinceMs: number, untilMs: number) {
      return rows.filter((r) => r.kind === 'alarm' && r.status === 'delivered' && r.attempts > 0 && (r.deliveredAt ?? 0) >= sinceMs && (r.deliveredAt ?? 0) <= untilMs).length;
    },
    async markSummarized(ids: readonly string[], at: number) {
      for (const id of ids) Object.assign(find(id)!, { status: 'delivered', deliveredAt: at });
    },
    async listSummarized(fromMs: number, toMs: number) {
      return rows.filter((r) => r.kind === 'alarm' && r.status === 'delivered' && r.attempts === 0 && (r.deliveredAt ?? 0) >= fromMs && (r.deliveredAt ?? 0) < toMs);
    },
    async setText(id: string, text: string) {
      find(id)!.text = text;
    },
    async hasSlot(slotKey: string) {
      return self.rows.some((r) => r.slotKey === slotKey);
    },
  };
  return self;
}

function memorySink(outcome: () => AlarmDeliveryOutcome = () => ({ result: 'ok', status: 200 })): AlarmSink & { sent: AlarmMessage[] } {
  const sent: AlarmMessage[] = [];
  return {
    sent,
    async deliver(msg) {
      sent.push(msg);
      return outcome();
    },
  };
}

const lease: OpsLease = { acquire: async () => true, release: async () => {} };

function setup(opts: { cls?: 'test' | 'rehearsal'; telegram?: boolean } = {}) {
  let now = T0;
  const { lines, log } = captureLog();
  const outbox = memoryOutbox();
  const logged: { source: string; code: string; details?: AlarmDetails }[] = [];
  const saved: { source: string; code: string; details?: AlarmDetails }[] = [];
  const sink = memorySink();
  const alarm = createDeliveringAlarm({
    logger: log,
    alarmStore: { save: async (a) => (saved.push(a), { id: String(saved.length) }) },
    outbox,
    logStore: { insert: async (a) => (logged.push(a), { id: String(logged.length) }) },
    telegram: opts.telegram === false ? null : { sink, chatId: CHAT },
    cls: opts.cls ?? 'rehearsal',
    secretValues: [SECRET],
    clock: { now: () => now },
  });
  return { alarm, lines, outbox, logged, saved, sink, at: (t: number) => void (now = t), now: () => now };
}

describe('delivering alarm (W12)', () => {
  it('AC-1: the stdout line equals the one of createAlarm alone; raise returns synchronously when every sink throws or hangs', async () => {
    const before = captureLog();
    const plain = createAlarm(before.log, undefined, { now: () => T0 });
    const after = captureLog();
    const outbox = memoryOutbox();
    outbox.hang = true;
    const throwing = () => {
      throw new Error('down');
    };
    const wrapped = createDeliveringAlarm({
      logger: after.log,
      alarmStore: { save: () => new Promise(() => {}) },
      outbox: { ...outbox, pendingOfKind: throwing, latestDeliveredOfKind: () => new Promise(() => {}) } as unknown as Outbox,
      logStore: { insert: throwing },
      telegram: { sink: { deliver: () => new Promise(() => {}) }, chatId: CHAT },
      cls: 'test',
      secretValues: [],
      clock: { now: () => T0 },
      outboxTimeoutMs: 5,
    });
    const inputs: AlarmInput[] = [PAGE, PAGE, { level: 'log', source: 'clock', code: 'refresh_failed', details: { pgCode: '57P01' } }, { level: 'page', source: 'x', code: 'unknown' }];
    for (const a of inputs) {
      plain.raise(a);
      const started = performance.now();
      expect(wrapped.raise(a)).toBeUndefined();
      expect(performance.now() - started).toBeLessThan(50);
    }
    expect(after.lines.slice(0, before.lines.length)).toEqual(before.lines);
    await new Promise((r) => setTimeout(r, 30));
  });

  it('AC-2, AC-11: page → one outbox row with allow-listed details and the final text; the alarms save gets the same details', async () => {
    const s = setup();
    s.alarm.raise({ ...PAGE, details: { attempts: 3, email: 'a@b.c', token: SECRET, ip: '10.0.0.1' } });
    await settle();
    expect(s.outbox.rows).toHaveLength(1);
    const row = s.outbox.rows[0]!;
    expect(row).toMatchObject({ kind: 'alarm', alarm: { source: 'catalog', code: 'catalog-r2-copy-failed', level: 'page' }, details: { attempts: 3 } });
    expect(row.text).toContain('ТРИВОГА');
    expect(row.text).not.toContain('a@b.c');
    expect(row.text).not.toContain(SECRET);
    expect(s.saved).toEqual([{ source: 'catalog', code: 'catalog-r2-copy-failed', details: { attempts: 3 } }]);
    expect(s.logged).toEqual([]);
  });

  it('AC-12: log → one log-alarms row with sanitized details, no outbox row; repeats inside the throttle are not stored again', async () => {
    const s = setup();
    s.alarm.raise({ level: 'log', source: 'clock', code: 'refresh_failed', details: { pgCode: '57P01', text: 'hello world' } });
    s.alarm.raise({ level: 'log', source: 'clock', code: 'refresh_failed', details: { pgCode: '57P01' } });
    await settle();
    expect(s.logged).toEqual([{ source: 'clock', code: 'refresh_failed', details: { pgCode: '57P01' } }]);
    expect(s.outbox.rows).toEqual([]);
  });

  it('AC-5: ops/telegram-* never reach the outbox, even at page level', async () => {
    const s = setup();
    s.alarm.raise({ level: 'page', source: 'ops', code: 'telegram-delivery-failed' });
    s.alarm.raise({ level: 'log', source: 'ops', code: 'telegram-not-configured' });
    await settle();
    expect(s.outbox.rows).toEqual([]);
    expect(s.logged.map((l) => l.code)).toEqual(['telegram-delivery-failed', 'telegram-not-configured']);
  });

  it('AC-6: repeats of one kind count on the pending row (one row per kind while Telegram is down)', async () => {
    const s = setup();
    for (let i = 0; i < 50; i += 1) s.alarm.raise(PAGE);
    await settle(40);
    expect(s.outbox.rows).toHaveLength(1);
    expect(s.outbox.rows[0]!.repeatCount).toBe(49);
  });

  it('AC-6: within 10 min of a delivered message → counter; after 10 min → a new row saying «повторилось N разів»', async () => {
    const s = setup();
    s.alarm.raise(PAGE);
    await settle();
    await s.outbox.markDelivered('1', T0 + 1_000);
    for (let i = 0; i < 49; i += 1) {
      s.at(T0 + 2_000 + i * 10_000);
      s.alarm.raise(PAGE);
      await settle(4);
    }
    expect(s.outbox.rows).toHaveLength(1);
    s.at(T0 + 11 * 60_000);
    s.alarm.raise(PAGE);
    await settle();
    expect(s.outbox.rows).toHaveLength(2);
    expect(s.outbox.rows[1]!.text).toContain('повторилось 49 разів');
  });

  it('AC-9: outbox write fails → stdout alarm_outbox_failed and a direct send, once per 10 min per kind', async () => {
    const s = setup();
    s.outbox.failInsert = true;
    s.alarm.raise(PAGE);
    await settle();
    s.at(T0 + 61_000);
    s.alarm.raise(PAGE);
    await settle();
    expect(s.sink.sent).toHaveLength(1);
    expect(s.sink.sent[0]!.chatId).toBe(CHAT);
    expect(s.lines.filter((l) => l.code === 'alarm_outbox_failed')).toHaveLength(2);
    s.at(T0 + DIRECT_SEND_WINDOW_MS + 1);
    s.alarm.raise(PAGE);
    await settle();
    expect(s.sink.sent).toHaveLength(2);
  });

  it('AC-27: unregistered kind → domain «невідомо»; in class test a marker ops/unregistered-alarm', async () => {
    const s = setup({ cls: 'test' });
    s.alarm.raise({ level: 'page', source: 'nobody', code: 'never-registered' });
    await settle();
    expect(s.outbox.rows[0]!.text).toContain('Домен: невідомо');
    expect(s.logged).toEqual([{ source: 'ops', code: 'unregistered-alarm', details: { source: 'nobody', code: 'never-registered' } }]);
  });

  it('AC-14: no Telegram → no outbox row; alarms and log-alarms as usual', async () => {
    const s = setup({ telegram: false });
    s.alarm.raise(PAGE);
    await settle();
    expect(s.outbox.rows).toEqual([]);
    expect(s.saved).toHaveLength(1);
  });
});

describe('sender (W13)', () => {
  function senderSetup(outcome?: () => AlarmDeliveryOutcome) {
    const outbox = memoryOutbox();
    const sink = memorySink(outcome);
    const raised: AlarmInput[] = [];
    const sender = createSender({ lease, outbox, sink, chatId: CHAT, cls: 'rehearsal', alarm: { raise: (a) => void raised.push(a) } });
    const add = (code: string, at: number) =>
      outbox.insert({ kind: 'alarm', alarm: { source: 'test', code, level: 'page' }, text: `alarm ${code}`, chatId: CHAT, createdAt: at });
    return { outbox, sink, raised, sender, add };
  }

  it('AC-7: 40 kinds within a minute → 20 messages, then one summary at the window end', async () => {
    const s = senderSetup();
    for (let i = 0; i < 40; i += 1) await s.add(`k${i}`, T0 + i * 1_000);
    for (let t = T0 + 40_000; t < T0 + 11 * 60_000; t += 5_000) await s.sender.tick(t);
    const summaries = s.sink.sent.filter((m) => m.text.includes('Забагато тривог'));
    expect(s.sink.sent.length - summaries.length).toBe(20);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.text).toContain('ще 20');
  });

  it('AC-4/AC-5: retries until 10 min, then failed with one log alarm ops/telegram-delivery-failed', async () => {
    const s = senderSetup(() => ({ result: 'retry', status: 502 }));
    await s.add('a', T0);
    await s.add('b', T0);
    for (let t = T0; t <= T0 + 11 * 60_000; t += 5_000) await s.sender.tick(t);
    expect(s.outbox.rows.every((r) => r.status === 'failed')).toBe(true);
    expect(s.raised).toEqual([expect.objectContaining({ level: 'log', source: 'ops', code: 'telegram-delivery-failed' })]);
  });

  it('AC-4: 400 → one attempt, failed', async () => {
    const s = senderSetup(() => ({ result: 'fatal', status: 400 }));
    await s.add('a', T0);
    await s.sender.tick(T0);
    await s.sender.tick(T0 + 60_000);
    expect(s.sink.sent).toHaveLength(1);
    expect(s.outbox.rows[0]!.status).toBe('failed');
  });
});
