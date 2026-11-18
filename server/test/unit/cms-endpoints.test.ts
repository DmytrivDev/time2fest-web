/**
 * SPEC-07 W33–W37 over fakes (AC-51 … AC-54, AC-56, AC-75, AC-77, AC-78, NFR-7):
 * - the root endpoint list per class: `POST /clock` absent in production (AC-52);
 * - `POST /clock`: not the owner / not through the gate → 403 and the deps are never even resolved
 *   (nothing changes, AC-53); a non-JSON type, an oversized or non-schema body (speed!) → 400;
 * - `controlClock`: one change per action with the actor, one `clock` event `clock:<epoch>:<seq>`;
 *   speed only for `ops`; production refused; a failed publish keeps the change (C3);
 * - `festivalState`: a failing lease store → only `scheduler` in `errors` (AC-78);
 * - the CLI: production (or no class) → exit 2 before `open` (no database), bad arguments → exit 2.
 */
import type { PayloadRequest } from 'payload';
import { describe, expect, it } from 'vitest';
import { cmsEndpointsFor } from '../../src/admin/cmsEndpoints';
import { parseClockArgs, runClockCli, type ClockCliPorts } from '../../src/cli/clock';
import { realClock } from '../../src/clock';
import { initialState, type VirtualState } from '../../src/domain/timekeeping/virtual';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import { festivalState, type FestivalStateDeps } from '../../src/scheduler/festival';
import type { PublishResult } from '../../src/realtime/ports';
import { controlClock, OPS_ACTOR, type ClockControlDeps } from '../../src/timekeeping/control';
import type { Actor, ClockStateStore } from '../../src/timekeeping/ports';
import { createSharedClock } from '../../src/timekeeping/shared';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const OWNER: Actor = { kind: 'owner', id: '7', label: 'owner@example.com' };
const AT = Date.parse('2026-12-31T22:50:00Z');

function fakeClock() {
  const box = { stored: initialState(realClock.now()), actors: [] as Actor[] };
  const store: ClockStateStore = {
    async load() {
      return box.stored;
    },
    async change(actor, fn) {
      box.stored = fn(box.stored, realClock.now());
      box.actors.push(actor);
      return box.stored;
    },
  };
  return { box, clock: createSharedClock({ store, real: realClock, cache: { state: box.stored } }) };
}

function fakePublisher(result: PublishResult | 'throw' = { status: 'ok' }) {
  const sent: { cls: string; env: RealtimeEnvelope }[] = [];
  return {
    sent,
    publisher: {
      async publish(cls: string, _key: string | undefined, env: RealtimeEnvelope): Promise<PublishResult> {
        sent.push({ cls, env });
        if (result === 'throw') throw new Error('down');
        return result;
      },
    },
  };
}

const paths = (cls: 'production' | 'rehearsal' | 'test') => cmsEndpointsFor(cls, () => Promise.reject(new Error('not resolved'))).map((e) => `${e.method} ${e.path}`);

describe('root cms endpoints per class', () => {
  it('AC-52: production has only the read-only slice; rehearsal and test also have POST /clock', () => {
    expect(paths('production')).toEqual(['get /festival-state']);
    expect(paths('rehearsal')).toEqual(['get /festival-state', 'post /clock']);
    expect(paths('test')).toEqual(['get /festival-state', 'post /clock']);
  });
});

describe('POST /clock refusals', () => {
  let resolved = 0;
  const resolve = () => {
    resolved += 1;
    return Promise.reject(new Error('deps must not be reached'));
  };
  const handler = cmsEndpointsFor('rehearsal', resolve).find((e) => e.path === '/clock')!.handler;
  const req = (opts: { role?: string | null; gate?: boolean; type?: string; body?: string }): PayloadRequest =>
    ({
      user: opts.role === null ? null : { id: 7, email: 'x@example.com', role: opts.role ?? 'owner' },
      // A server-side call (no host) stands for "passed the gate"; a REST call with a host and no marker did not.
      payloadAPI: opts.gate === false ? 'REST' : 'local',
      headers: new Headers({ ...(opts.gate === false ? { host: 'admin.test' } : {}), 'content-type': opts.type ?? 'application/json' }),
      context: {},
      text: async () => opts.body ?? JSON.stringify({ action: 'real' }),
    }) as unknown as PayloadRequest;
  const call = async (r: PayloadRequest) => {
    const res = await handler(r);
    return { status: res.status, body: (await res.json()) as { ok: boolean; error?: { code: string } } };
  };

  it('AC-53, AC-77: another role, no user, or no gate → 403 forbidden, deps never resolved', async () => {
    for (const r of [req({ role: 'content-agent' }), req({ role: null }), req({ gate: false })]) {
      expect(await call(r)).toEqual({ status: 403, body: { ok: false, error: { code: 'forbidden' } } });
    }
    const slice = cmsEndpointsFor('production', resolve).find((e) => e.path === '/festival-state')!.handler;
    expect((await slice(req({ role: 'stream-agent' }))).status).toBe(403);
    expect(resolved).toBe(0);
  });

  it('S4-01, C9: a non-JSON type, a body over 1 KB, an unknown action or speed → 400 validation, deps never resolved', async () => {
    const bodies = [
      req({ type: 'text/plain' }),
      req({ body: JSON.stringify({ action: 'set', at: AT, pad: 'x'.repeat(1100) }) }),
      req({ body: JSON.stringify({ action: 'speed', speed: 60 }) }),
      req({ body: JSON.stringify({ action: 'set', at: -1 }) }),
      req({ body: '{not json' }),
    ];
    for (const r of bodies) expect(await call(r)).toEqual({ status: 400, body: { ok: false, error: { code: 'validation' } } });
    expect(resolved).toBe(0);
  });
});

describe('controlClock', () => {
  const depsOf = (cls: ClockControlDeps['cls'], result?: PublishResult | 'throw') => {
    const c = fakeClock();
    const p = fakePublisher(result);
    const d: ClockControlDeps = { cls, clock: c.clock, publisher: p.publisher, log: silent };
    return { ...c, ...p, d };
  };

  it('AC-51, AC-56, NFR-7: set, restart-night, real — one change each with the actor, one clock event each', async () => {
    const { d, box, sent } = depsOf('rehearsal');
    const set = await controlClock(d, 'owner', OWNER, { action: 'set', at: AT });
    expect(set).toMatchObject({ ok: true, value: { virtual: true, speed: 1, epoch: 0, seq: 1, eventId: 'clock:0:1', published: 'ok' } });
    expect(set.ok && Math.abs(set.value.now - AT)).toBeLessThan(1_000);
    const restart = await controlClock(d, 'owner', OWNER, { action: 'restart-night' });
    expect(restart).toMatchObject({ ok: true, value: { virtual: true, epoch: 1, seq: 2, eventId: 'clock:1:2' } });
    const real = await controlClock(d, 'owner', OWNER, { action: 'real' });
    expect(real).toMatchObject({ ok: true, value: { virtual: false, speed: 1, epoch: 1, seq: 3 } });
    expect(box.actors).toEqual([OWNER, OWNER, OWNER]);
    expect(sent.map((s) => s.cls)).toEqual(['site:state', 'site:state', 'site:state']);
    expect(sent.map((s) => s.env)).toEqual([
      { type: 'clock', id: 'clock:0:1', data: { virtual: true, speed: 1 } },
      { type: 'clock', id: 'clock:1:2', data: { virtual: true, speed: 1 } },
      { type: 'clock', id: 'clock:1:3', data: { virtual: false, speed: 1 } },
    ]);
  });

  it('AC-54: speed is an ops action only (0..600 integers); the owner is refused without a change', async () => {
    const { d, box, sent } = depsOf('rehearsal');
    expect(await controlClock(d, 'owner', OWNER, { action: 'speed', speed: 60 })).toEqual({ ok: false, code: 'forbidden' });
    expect(await controlClock(d, 'ops', OPS_ACTOR, { action: 'speed', speed: 601 })).toEqual({ ok: false, code: 'validation' });
    expect(await controlClock(d, 'ops', OPS_ACTOR, { action: 'speed', speed: 1.5 })).toEqual({ ok: false, code: 'validation' });
    expect(box.actors).toEqual([]);
    expect(sent).toEqual([]);
    expect(await controlClock(d, 'ops', OPS_ACTOR, { action: 'speed', speed: 60 })).toMatchObject({ ok: true, value: { speed: 60, virtual: true } });
    expect(box.actors).toEqual([OPS_ACTOR]);
  });

  it('AC-52: production → forbidden, nothing changes, nothing is published', async () => {
    const { d, box, sent } = depsOf('production');
    expect(await controlClock(d, 'ops', OPS_ACTOR, { action: 'real' })).toEqual({ ok: false, code: 'forbidden' });
    expect(box.actors).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('C3: an unavailable or throwing publisher, or none, never undoes the change', async () => {
    for (const result of [{ status: 'unavailable' } as const, 'throw' as const]) {
      const { d, box } = depsOf('rehearsal', result);
      expect(await controlClock(d, 'owner', OWNER, { action: 'set', at: AT })).toMatchObject({ ok: true, value: { published: 'unavailable', seq: 1 } });
      expect(box.stored.virtual).toBe(true);
    }
    const { d, box } = depsOf('test');
    const without: ClockControlDeps = { cls: d.cls, clock: d.clock, log: d.log };
    expect(await controlClock(without, 'owner', OWNER, { action: 'set', at: AT })).toMatchObject({ ok: true, value: { published: 'not-configured' } });
    expect(box.stored.seq).toBe(1);
  });
});

describe('festivalState', () => {
  const zones = [
    { zoneId: 'utc+0200', midnightMs: Date.parse('2026-12-31T22:00:00Z') },
    { zoneId: 'utc+0100', midnightMs: Date.parse('2026-12-31T23:00:00Z') },
    { zoneId: 'utc+0000', midnightMs: Date.parse('2027-01-01T00:00:00Z') },
  ];
  const base = (): FestivalStateDeps => ({
    clock: { now: () => AT },
    clockState: () => ({ ...initialState(AT), virtual: true, speed: 1, runEpoch: 4, seq: 9 }) satisfies VirtualState,
    source: { load: async () => ({ seasonId: '2026-27', zones, events: [] }) },
    lease: { read: async () => ({ holder: 'node-a:12:abcd', epoch: 3, expiresInMs: 4_000, renewedAgoMs: 1_500 }) },
    runs: { missed24h: async () => ({ skipped: 1, failed: 2 }) },
    divergence: { current: () => ({ value: -42, level: 'ok' as const, streak: 0, windowStart: AT - 60_000 }) },
  });

  it('AC-75: phase, slots, next moments, scheduler health, edge skew and clock at 23:50 Paris', async () => {
    const view = await festivalState(base());
    expect(view.errors).toBeUndefined();
    expect(view.phase).toBe('during');
    expect(view.slot).toEqual({ current: 'utc+0100', next: 'utc+0000' });
    expect(view.moments[0]).toEqual({ at: Date.parse('2026-12-31T23:00:00Z'), kind: 'pin-end', subject: 'utc+0100' });
    expect(view.moments.every((m) => m.at > AT)).toBe(true);
    expect(view.scheduler).toEqual({ holder: 'node-a:12:abcd', epoch: 3, renewedAgeMs: 1_500, delayMs: null, missed24h: 3 });
    expect(view.edgeSkewMs).toBe(-42);
    expect(view.clock).toEqual({ virtual: true, speed: 1, epoch: 4, now: AT });
  });

  it('AC-78: a failing lease store → only the scheduler block is an error; the rest is computed', async () => {
    const view = await festivalState({ ...base(), lease: { read: () => Promise.reject(new Error('lease store down')) } });
    expect(view.errors).toEqual(['scheduler']);
    expect(view.scheduler).toEqual({ holder: null, epoch: 0, renewedAgeMs: null, delayMs: null, missed24h: 0 });
    expect(view.phase).toBe('during');
    expect(view.slot.current).toBe('utc+0100');
    expect(view.clock.epoch).toBe(4);
  });

  it('AC-78: a failing moment source → phase, slot and moments are errors; health and clock still shown', async () => {
    const view = await festivalState({ ...base(), source: { load: () => Promise.reject(new Error('catalog down')) } });
    expect(view.errors).toEqual(['phase', 'slot', 'moments']);
    expect(view.scheduler.holder).toBe('node-a:12:abcd');
    expect(view.clock.virtual).toBe(true);
  });

  it('an expired lease shows no holder', async () => {
    const view = await festivalState({ ...base(), lease: { read: async () => ({ holder: 'node-a:12:abcd', epoch: 3, expiresInMs: 0, renewedAgoMs: 9_000 }) } });
    expect(view.scheduler.holder).toBeNull();
  });
});

describe('clock CLI', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) } };
  };
  const neverOpen = () => Promise.reject(new Error('open must not be called')) as Promise<ClockCliPorts>;

  it('AC-54/AC-55 server side: production or no class → exit 2 before any database call', async () => {
    for (const env of [{ T2F_ENV: 'production' }, {}, { T2F_ENV: 'prod' }]) {
      const o = io();
      let opened = 0;
      const code = await runClockCli(['status'], env, o.io, () => {
        opened += 1;
        return neverOpen();
      });
      expect(code).toBe(2);
      expect(opened).toBe(0);
      expect(JSON.parse(o.out.at(-1) ?? '')).toEqual({ ok: false, error: { code: 'class' } });
    }
  });

  it('bad arguments → exit 2 with one JSON line, nothing opened', async () => {
    for (const argv of [[], ['jump'], ['set'], ['set', '--at', '2026-12-31T23:00:00+01:00'], ['speed', '601'], ['speed', '-1'], ['records', '--epoch', 'x'], ['real', 'now']]) {
      const o = io();
      expect(await runClockCli(argv, { T2F_ENV: 'rehearsal' }, o.io, neverOpen)).toBe(2);
      expect(JSON.parse(o.out.at(-1) ?? '')).toEqual({ ok: false, error: { code: 'usage' } });
    }
  });

  it('status and records over fake ports: lease, next instant with its due (action, moment) pairs; set as ops', async () => {
    const { box, clock } = fakeClock();
    await clock.change(OPS_ACTOR, (s, real) => ({ ...s, virtual: true, anchorVirtual: Date.parse('2026-12-31T22:59:30Z'), anchorReal: real, speed: 1, frozen: true, runEpoch: 2, seq: 5 }));
    box.actors.length = 0;
    let refreshed = 0;
    let closed = 0;
    const ports: ClockCliPorts = {
      cls: 'rehearsal',
      shared: { refresh: async () => void (refreshed += 1), state: () => clock.state(), view: () => clock.view() },
      control: { cls: 'rehearsal', clock, log: silent },
      readers: {
        lease: { read: async () => ({ holder: 'node-a:12:abcd', epoch: 3, expiresInMs: 4_000, renewedAgoMs: 1_000 }) },
        runs: { ledger: async () => ({ settled: new Set(['run-recorder|pin-end:utc+0100']), started: new Map() }), missed24h: async () => ({ skipped: 0, failed: 0 }) },
        source: { load: async () => ({ seasonId: '2026-27', zones: [{ zoneId: 'utc+0100', midnightMs: Date.parse('2026-12-31T23:00:00Z') }], events: [] }) },
      },
      records: { list: async (epoch) => [{ consequenceId: 'c1', keys: ['k'], action: 'run-recorder', runEpoch: epoch, plannedAt: 1, startedAt: 2, at: 3 }] },
      rows: [{ key: 'run-recorder', kinds: ['zone-midnight', 'pin-end'], late: 'always' }],
      close: async () => void (closed += 1),
    };
    const o = io();
    expect(await runClockCli(['status'], { T2F_ENV: 'rehearsal' }, o.io, async () => ports)).toBe(0);
    const status = JSON.parse(o.out.at(-1) ?? '');
    expect(status).toMatchObject({ runEpoch: 2, speed: 1, frozen: true, virtual: true, lease: { holder: 'node-a:12:abcd', epoch: 3, expiresInMs: 4_000 } });
    expect(status.nextMoment.at).toBe(Date.parse('2026-12-31T23:00:00Z'));
    expect(status.nextMoment).toMatchObject({ key: 'zone-midnight:utc+0100', due: [{ action: 'run-recorder', key: 'zone-midnight:utc+0100' }] });
    expect(o.out).toHaveLength(1);

    expect(await runClockCli(['records'], { T2F_ENV: 'rehearsal' }, o.io, async () => ports)).toBe(0);
    expect(JSON.parse(o.out.at(-1) ?? '')).toEqual({ epoch: 2, records: [{ keys: ['k'], action: 'run-recorder', plannedAt: 1, startedAt: 2, at: 3, consequenceId: 'c1' }] });

    expect(await runClockCli(['restart-night'], { T2F_ENV: 'rehearsal' }, o.io, async () => ports)).toBe(0);
    expect(JSON.parse(o.out.at(-1) ?? '')).toMatchObject({ action: 'restart-night', epoch: 3, runEpoch: 3, published: 'not-configured' });
    expect(box.actors).toEqual([OPS_ACTOR]);
    expect(refreshed).toBe(3);
    expect(closed).toBe(3);
  });

  it('parses every action of the ops contract', () => {
    expect(parseClockArgs(['status'])).toEqual({ ok: true, command: { cmd: 'status' } });
    expect(parseClockArgs(['set', '--at', '2026-12-31T22:59:30Z'])).toEqual({ ok: true, command: { cmd: 'control', action: { action: 'set', at: Date.parse('2026-12-31T22:59:30Z') } } });
    expect(parseClockArgs(['real'])).toEqual({ ok: true, command: { cmd: 'control', action: { action: 'real' } } });
    expect(parseClockArgs(['restart-night'])).toEqual({ ok: true, command: { cmd: 'control', action: { action: 'restart-night' } } });
    expect(parseClockArgs(['speed', '0'])).toEqual({ ok: true, command: { cmd: 'control', action: { action: 'speed', speed: 0 } } });
    expect(parseClockArgs(['speed', '600'])).toEqual({ ok: true, command: { cmd: 'control', action: { action: 'speed', speed: 600 } } });
    expect(parseClockArgs(['records'])).toEqual({ ok: true, command: { cmd: 'records' } });
    expect(parseClockArgs(['records', '--epoch', '3'])).toEqual({ ok: true, command: { cmd: 'records', epoch: 3 } });
  });
});
