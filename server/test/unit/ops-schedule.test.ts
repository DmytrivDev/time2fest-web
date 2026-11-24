/**
 * SPEC-13b W19 (unit): the ops schedule on the real wall clock — heartbeat slots of the celebration window (AC-18),
 * the fallback window (AC-19), the missed-slot rule (AC-21), independence from the SPEC-07 test clock (AC-22),
 * the digest slot and its text (AC-20), backup slots 1/day vs hourly (AC-40), stale boundaries (AC-45), the
 * hourly snapshot gap (NFR-2) and the `log-alarms` prune boundary (AC-12).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LogAlarmRecord } from '../../src/alarms/ports';
import { clockFor, processClockCache } from '../../src/clock';
import { buildHeartbeatText } from '../../src/domain/ops/alarmText';
import {
  backupSlotAt,
  celebrationWindow,
  digestSlotAt,
  heartbeatSlotAt,
  inHourlyBackupWindow,
  isBackupStale,
  localParts,
  logPruneBefore,
  missedSlotDecision,
  staleThresholdMs,
} from '../../src/domain/ops/schedule';
import { initialState, testSet } from '../../src/domain/timekeeping/virtual';
import { createDigestJob } from '../../src/ops/digest';
import { createHeartbeatJob, type OpsReads, type PlanJobDeps } from '../../src/ops/heartbeat';
import type { NewOutboxRow, Outbox } from '../../src/ops/ports';
import { createOpsRunner, startOpsTicker, type OpsWiring } from '../../src/ops/runner';
import type { AlarmInput } from '../../src/ports';

const MIN = 60_000;
const HOUR = 60 * MIN;
const utc = (s: string) => Date.parse(s);
const iso = (ms: number) => new Date(ms).toISOString();

/** Midnights of the 2026-27 season: UTC+14 (Kiribati) … UTC+2 (Kyiv) … UTC−12. */
const ZONES = {
  zones: [
    { midnightMs: utc('2026-12-31T10:00:00Z') },
    { midnightMs: utc('2026-12-31T22:00:00Z') },
    { midnightMs: utc('2027-01-01T00:00:00Z') },
    { midnightMs: utc('2027-01-01T12:00:00Z') },
  ],
};

interface Harness {
  deps: PlanJobDeps;
  rows: NewOutboxRow[];
  alarms: AlarmInput[];
  lines: { action: string; target: string; after: Record<string, unknown> }[];
}

function harness(reads: Partial<OpsReads> = {}): Harness {
  const rows: NewOutboxRow[] = [];
  const alarms: AlarmInput[] = [];
  const lines: Harness['lines'] = [];
  const outbox: Pick<Outbox, 'hasSlot' | 'insert'> = {
    async insert(row) {
      if (row.slotKey && rows.some((r) => r.slotKey === row.slotKey)) return 'duplicate-slot';
      rows.push(row);
      return { id: String(rows.length) };
    },
    hasSlot: async (key) => rows.some((r) => r.slotKey === key),
  };
  return {
    rows,
    alarms,
    lines,
    deps: {
      lease: { acquire: async () => true, release: async () => {} },
      outbox,
      journal: { line: async (action, target, after) => void lines.push({ action, target, after }) },
      reads: {
        zones: async () => ZONES,
        openPageCount: async () => 0,
        lastBackupAt: async () => null,
        deliveryState: () => 'ok',
        ...reads,
      },
      alarm: { raise: (a) => void alarms.push(a) },
      chatId: '-42',
      cls: 'test',
    },
  };
}

/** Runs `job` every `stepMs` over `[from, to]`, as a live process would. */
async function sweep(job: { run(now: number): Promise<unknown> }, from: number, to: number, stepMs = MIN): Promise<void> {
  for (let t = from; t <= to; t += stepMs) await job.run(t);
}

describe('heartbeat slots (AC-18, AC-19, AC-21)', () => {
  it('AC-18: wall time 31.12 07:00 … 01.01 15:00 UTC → one heartbeat at each :00 from 08:00 to 14:00, nothing else', async () => {
    const h = harness();
    await sweep(createHeartbeatJob(h.deps), utc('2026-12-31T07:00:00Z'), utc('2027-01-01T15:00:00Z'));
    const want: string[] = [];
    for (let t = utc('2026-12-31T08:00:00Z'); t <= utc('2027-01-01T14:00:00Z'); t += HOUR) want.push(iso(t).slice(0, 13));
    expect(h.rows.map((r) => r.slotKey)).toEqual(want.map((k) => `hb:${k}`));
    expect(h.rows).toHaveLength(31);
    expect(h.rows.every((r) => r.kind === 'heartbeat' && r.chatId === '-42')).toBe(true);
    // Queued within the first minute of each slot.
    expect(h.rows.every((r) => r.createdAt % HOUR < MIN)).toBe(true);
    expect(h.alarms).toEqual([]);
    expect(h.lines).toEqual([]);
  });

  it('AC-18: a window start off the hour (first midnight UTC+13:45) is a slot of its own', async () => {
    const zones = { zones: [{ midnightMs: utc('2026-12-31T10:15:00Z') }, { midnightMs: utc('2026-12-31T22:00:00Z') }] };
    const w = celebrationWindow(zones, utc('2026-12-31T00:00:00Z'));
    expect(iso(w.start)).toBe('2026-12-31T08:15:00.000Z');
    expect(heartbeatSlotAt(utc('2026-12-31T08:14:59Z'), w)).toBeNull();
    expect(heartbeatSlotAt(utc('2026-12-31T08:20:00Z'), w)).toEqual({ key: 'hb:2026-12-31T08', due: utc('2026-12-31T08:15:00Z') });
    expect(heartbeatSlotAt(utc('2026-12-31T09:00:00Z'), w)?.due).toBe(utc('2026-12-31T09:00:00Z'));
    expect(heartbeatSlotAt(utc('2027-01-01T00:59:00Z'), w)?.key).toBe('hb:2027-01-01T00');
    expect(heartbeatSlotAt(utc('2027-01-01T01:00:00Z'), w)).toBeNull();
  });

  it('AC-19: zones throw or are empty → fallback window 31.12 08:00 – 01.01 14:00 UTC and ONE fallback alarm', async () => {
    const h = harness({
      zones: async () => {
        throw new Error('catalog down');
      },
    });
    await sweep(createHeartbeatJob(h.deps), utc('2026-12-31T07:00:00Z'), utc('2027-01-01T15:00:00Z'));
    expect(h.rows).toHaveLength(31);
    expect(h.rows[0]!.slotKey).toBe('hb:2026-12-31T08');
    expect(h.rows.at(-1)!.slotKey).toBe('hb:2027-01-01T14');
    expect(h.alarms).toEqual([{ level: 'log', source: 'ops', code: 'heartbeat-fallback-window' }]);
    expect(celebrationWindow({ zones: [] }, utc('2027-01-01T03:00:00Z'))).toEqual({
      start: utc('2026-12-31T08:00:00Z'),
      end: utc('2027-01-01T14:00:00Z'),
      fallback: true,
    });
    // Outside the window the fallback is not used, so no alarm all year long.
    const quiet = harness({ zones: async () => null });
    await sweep(createHeartbeatJob(quiet.deps), utc('2026-11-24T00:00:00Z'), utc('2026-11-24T06:00:00Z'));
    expect(quiet.alarms).toEqual([]);
    expect(quiet.rows).toEqual([]);
  });

  it('AC-21: a restart 5 min into a slot sends it; 15 min in → skipped with a journal line; already sent → nothing', async () => {
    const slot = { key: 'hb:2026-12-31T22', due: utc('2026-12-31T22:00:00Z') };
    expect(missedSlotDecision(slot, slot.due - 1)).toBe('wait');
    expect(missedSlotDecision(slot, slot.due + 10 * MIN)).toBe('send');
    expect(missedSlotDecision(slot, slot.due + 10 * MIN + 1)).toBe('skip');

    const caughtUp = harness();
    expect(await createHeartbeatJob(caughtUp.deps).run(utc('2026-12-31T22:05:00Z'))).toEqual({ result: 'queued', slotKey: 'hb:2026-12-31T22' });

    const late = harness();
    const job = createHeartbeatJob(late.deps);
    expect(await job.run(utc('2026-12-31T22:15:00Z'))).toEqual({ result: 'skipped', slotKey: 'hb:2026-12-31T22' });
    expect(await job.run(utc('2026-12-31T22:20:00Z'))).toEqual({ result: 'idle' });
    expect(late.rows).toEqual([]);
    expect(late.lines).toEqual([
      { action: 'ops.heartbeat-skipped', target: 'hb:2026-12-31T22', after: { slotKey: 'hb:2026-12-31T22', dueAt: '2026-12-31T22:00:00.000Z', lateMs: 15 * MIN } },
    ]);

    // The slot was queued before the restart (or by the other instance): no skip line.
    const sent = harness();
    await createHeartbeatJob(sent.deps).run(utc('2026-12-31T22:00:05Z'));
    expect(await createHeartbeatJob(sent.deps).run(utc('2026-12-31T22:15:00Z'))).toEqual({ result: 'duplicate', slotKey: 'hb:2026-12-31T22' });
    expect(sent.lines).toEqual([]);
    expect(sent.rows).toHaveLength(1);
  });

  it('AC-21: two jobs (two instances) over one outbox → one row per slot', async () => {
    const h = harness();
    const a = createHeartbeatJob(h.deps);
    const b = createHeartbeatJob(h.deps);
    for (let t = utc('2026-12-31T20:00:00Z'); t <= utc('2026-12-31T23:30:00Z'); t += MIN) await Promise.all([a.run(t), b.run(t)]);
    expect(h.rows.map((r) => r.slotKey)).toEqual(['hb:2026-12-31T20', 'hb:2026-12-31T21', 'hb:2026-12-31T22', 'hb:2026-12-31T23']);
  });

  it('a held lease elsewhere → not held, retried next run', async () => {
    const h = harness();
    let held = false;
    h.deps.lease = { acquire: async () => held, release: async () => {} };
    const job = createHeartbeatJob(h.deps);
    expect((await job.run(utc('2026-12-31T22:00:05Z'))).result).toBe('not-held');
    held = true;
    expect((await job.run(utc('2026-12-31T22:00:10Z'))).result).toBe('queued');
  });

  it('AC-18: heartbeat texts (snapshot)', async () => {
    const at = utc('2026-12-31T22:00:00Z');
    expect(buildHeartbeatText({ cls: 'test', openPage: 0, lastBackupAgeMs: 40 * MIN, delivery: 'ok', at })).toMatchInlineSnapshot(`
      "Усе гаразд · середовище: тест (test)
      Відкритих тривог: 0
      Остання копія бази: 40 хв тому
      Доставка: усе доставлено
      Час: 01.01.2027 00:00:00 за Києвом · 31.12.2026 22:00:00 UTC"
    `);
    expect(buildHeartbeatText({ cls: 'rehearsal', openPage: 2, lastBackupAgeMs: null, delivery: 'retrying', at })).toMatchInlineSnapshot(`
      "Зв'язок працює; відкритих тривог: 2 · середовище: репетиція (rehearsal)
      Відкритих тривог: 2
      Остання копія бази: копій ще немає
      Доставка: є повідомлення в повторах
      Час: 01.01.2027 00:00:00 за Києвом · 31.12.2026 22:00:00 UTC"
    `);
    const h = harness({ openPageCount: async () => 3, lastBackupAt: async () => at - 2 * HOUR - 5 * MIN, deliveryState: () => 'failed-recently' });
    await createHeartbeatJob(h.deps).run(at + 3_000);
    expect(h.rows[0]!.text).toMatchInlineSnapshot(`
      "Зв'язок працює; відкритих тривог: 3 · середовище: тест (test)
      Відкритих тривог: 3
      Остання копія бази: 2 год 5 хв тому
      Доставка: за останню добу є недоставлені
      Час: 01.01.2027 00:00:00 за Києвом · 31.12.2026 22:00:00 UTC"
    `);
  });
});

describe('AC-22: wall clock only, the SPEC-07 test clock changes nothing', () => {
  const cache = processClockCache();
  const saved = cache.state;
  afterEach(() => {
    cache.state = saved;
  });

  it('test clock ×60 and moved to 31.12 22:00 while the wall clock is 24.11 → no heartbeat; wall clock 31.12 → one', async () => {
    const real = utc('2026-11-24T10:00:00Z');
    cache.state = testSet(initialState(Date.now()), { at: utc('2026-12-31T22:00:00Z'), speed: 60 }, Date.now());
    expect(clockFor('test').now()).toBeGreaterThanOrEqual(utc('2026-12-31T22:00:00Z'));

    const inserted: NewOutboxRow[] = [];
    const outbox = {
      insert: async (row: NewOutboxRow) => (inserted.push(row), { id: String(inserted.length) }),
      hasSlot: async () => false,
      claimDue: async () => [],
      countSent: async () => 0,
    } as unknown as Outbox;
    const ops = (now: number): OpsWiring => ({
      telegram: { status: 'configured', sink: { deliver: async () => ({ result: 'ok' }) }, chatId: '-42' },
      outbox,
      logAlarms: { insert: async () => ({ id: '1' }), listLog: async () => [], pruneLog: async () => 0 },
      lease: { acquire: async () => true, release: async () => {} },
      clock: { now: () => now },
      cls: 'test',
    });
    const sources = {
      zones: async () => ZONES,
      openPageCount: async () => 0,
      lastBackupAt: async () => null,
      spendOver50: async () => [],
      journal: { line: async () => {} },
    };
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const alarm = { raise: () => {} };

    const quiet = ops(real);
    const ticker = startOpsTicker(createOpsRunner({ ops: quiet, alarm, log, sources }), { ops: quiet, alarm, log }, 5);
    await new Promise((r) => setTimeout(r, 60));
    await ticker.stop();
    expect(inserted.filter((r) => r.kind === 'heartbeat')).toEqual([]);

    const festive = ops(utc('2026-12-31T22:00:02Z'));
    const ticker2 = startOpsTicker(createOpsRunner({ ops: festive, alarm, log, sources }), { ops: festive, alarm, log }, 5);
    await new Promise((r) => setTimeout(r, 60));
    await ticker2.stop();
    expect(inserted.filter((r) => r.kind === 'heartbeat').map((r) => r.slotKey)).toEqual(['hb:2026-12-31T22']);
  });
});

describe('digest (AC-20, AC-21)', () => {
  it('slot at 09:00 Kyiv: key by the Kyiv date, the previous day before 09:00', () => {
    expect(digestSlotAt(utc('2026-12-28T07:00:00Z'))).toEqual({ key: 'digest:2026-12-28', due: utc('2026-12-28T07:00:00Z') });
    expect(digestSlotAt(utc('2026-12-28T06:59:59Z'))).toEqual({ key: 'digest:2026-12-27', due: utc('2026-12-27T07:00:00Z') });
    expect(digestSlotAt(utc('2027-01-01T06:00:00Z')).key).toBe('digest:2026-12-31');
    // Summer time (UTC+3): 09:00 Kyiv = 06:00 UTC.
    expect(digestSlotAt(utc('2026-07-01T06:30:00Z')).due).toBe(utc('2026-07-01T06:00:00Z'));
  });

  it('7 log alarms of three domains → one digest with exact numbers; late start → no row, no line', async () => {
    const due = utc('2026-12-28T07:00:00Z');
    const logs: LogAlarmRecord[] = [
      ...[1, 2, 3].map((i) => ({ id: `c${i}`, source: 'clock', code: 'refresh_failed', details: null, raisedAt: due - i * HOUR })),
      ...[1, 2].map((i) => ({ id: `l${i}`, source: 'live', code: 'poller_tick_failed', details: null, raisedAt: due - i * MIN })),
      ...[1, 2].map((i) => ({ id: `m${i}`, source: 'mod', code: 'moderation_degraded', details: null, raisedAt: due - 20 * HOUR })),
      { id: 'old', source: 'clock', code: 'refresh_failed', details: null, raisedAt: due - 25 * HOUR },
    ];
    const h = harness({ openPageCount: async () => 1, lastBackupAt: async () => due - 3 * HOUR });
    const job = createDigestJob({
      ...h.deps,
      logAlarms: { listLog: async (since) => logs.filter((l) => l.raisedAt >= since) },
      spendOver50: async () => [{ title: 'Сервер', percent: 62.4 }],
    });
    await sweep(job, due - 5 * MIN, due + 2 * HOUR);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ kind: 'digest', slotKey: 'digest:2026-12-28' });
    expect(h.rows[0]!.text).toMatchInlineSnapshot(`
      "Ранковий підсумок 2026-12-28 · середовище: тест (test)
      Відкритих тривог: 1
      Остання копія бази: 3 год тому
      Витрати понад 50 %: Сервер 62 %
      Тривог рівня log за 24 год: 7
      Час: 3
      Ефір: 2
      Модерація й AI: 2
      Найчастіші види:
      clock/refresh_failed: 3
      live/poller_tick_failed: 2
      mod/moderation_degraded: 2"
    `);

    const late = harness();
    const lateJob = createDigestJob({ ...late.deps, logAlarms: { listLog: async () => [] }, spendOver50: async () => [] });
    expect((await lateJob.run(due + 15 * MIN)).result).toBe('skipped');
    expect(late.lines.map((l) => l.action)).toEqual(['ops.digest-skipped']);
    const started = harness();
    const startedJob = createDigestJob({ ...started.deps, logAlarms: { listLog: async () => [] }, spendOver50: async () => [] });
    expect((await startedJob.run(due + 3 * HOUR)).result).toBe('too-late');
    expect(started.lines).toEqual([]);
    expect(started.rows).toEqual([]);
  });
});

describe('backups, stale, prune (AC-40, AC-45, NFR-2, AC-12)', () => {
  /** Slots that become due while sweeping minute by minute, grouped by the Kyiv date of their due time. */
  function backupSlots(from: number, to: number): Map<string, number[]> {
    const seen = new Set<string>();
    const byDay = new Map<string, number[]>();
    for (let t = from; t <= to; t += MIN) {
      const s = backupSlotAt(t);
      if (seen.has(s.key) || t - s.due >= MIN) continue;
      seen.add(s.key);
      const p = localParts(s.due);
      const day = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
      byDay.set(day, [...(byDay.get(day) ?? []), s.due]);
    }
    return byDay;
  }

  it('AC-40: 25.12 … 03.01 → 1 a day outside (03:00 UTC), 24 a day inside the hourly window (26.12 – 02.01 Kyiv)', () => {
    const byDay = backupSlots(utc('2026-12-24T22:00:00Z'), utc('2027-01-03T21:59:00Z'));
    const counts = Object.fromEntries([...byDay].map(([d, v]) => [d, v.length]));
    expect(counts).toEqual({
      '2026-12-25': 1,
      '2026-12-26': 24,
      '2026-12-27': 24,
      '2026-12-28': 24,
      '2026-12-29': 24,
      '2026-12-30': 24,
      '2026-12-31': 24,
      '2027-01-01': 24,
      '2027-01-02': 24,
      '2027-01-03': 1,
    });
    expect(byDay.get('2026-12-25')).toEqual([utc('2026-12-25T03:00:00Z')]);
    expect(byDay.get('2027-01-03')).toEqual([utc('2027-01-03T03:00:00Z')]);
    expect(inHourlyBackupWindow(utc('2026-12-25T21:59:59Z'))).toBe(false);
    expect(inHourlyBackupWindow(utc('2026-12-25T22:00:00Z'))).toBe(true);
    expect(inHourlyBackupWindow(utc('2027-01-02T21:59:59Z'))).toBe(true);
    expect(inHourlyBackupWindow(utc('2027-01-02T22:00:00Z'))).toBe(false);
  });

  it('NFR-2: consecutive snapshots in the hourly window are ≤60 min apart', () => {
    const dues = [...backupSlots(utc('2026-12-25T22:00:00Z'), utc('2027-01-02T21:59:00Z')).values()].flat().sort((a, b) => a - b);
    expect(dues).toHaveLength(8 * 24);
    for (let i = 1; i < dues.length; i += 1) expect(dues[i]! - dues[i - 1]!).toBeLessThanOrEqual(HOUR);
  });

  it('AC-45: stale strictly over 26 h outside, 2 h inside the window', () => {
    const out = utc('2026-12-10T12:00:00Z');
    const inside = utc('2026-12-30T12:00:00Z');
    expect(staleThresholdMs(out)).toBe(26 * HOUR);
    expect(staleThresholdMs(inside)).toBe(2 * HOUR);
    expect(isBackupStale(out - 26 * HOUR, out)).toBe(false);
    expect(isBackupStale(out - 26 * HOUR - 1, out)).toBe(true);
    expect(isBackupStale(inside - 2 * HOUR, inside)).toBe(false);
    expect(isBackupStale(inside - 2 * HOUR - 1, inside)).toBe(true);
    expect(isBackupStale(null, out)).toBe(true);
  });

  it('AC-12: log alarms older than 30 days are pruned', () => {
    expect(logPruneBefore(utc('2026-12-31T00:00:00Z'))).toBe(utc('2026-12-01T00:00:00Z'));
  });
});
