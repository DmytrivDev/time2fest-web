/**
 * SPEC-07 shared virtual time across processes (AC-49, AC-50, NFR-7; W12, W15). Process A is the
 * test process; process B is a child (`support/clock-instance.ts`) with its own container, pool,
 * clock cache and event bus, on the same database. B's 5 s fallback refresh is stretched to 10 min,
 * so a change reaches it only through the `clock.changed` outbox event.
 * - AC-50: B, started after a change, reads the stored anchor, speed and epoch.
 * - AC-49: `POST /api/_test/clock` on A → `GET /api/_test/clock` on B shows it within 1 s; A and B
 *   differ by ≤ 50 ms.
 * - W12/NFR-7: one change = one global write, one journal row, one outbox row; a journal failure
 *   rolls the global back; no journal row holds the edge secret.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayloadClockStateStore } from '../../src/adapters/payloadClockState';
import { createTestClock, realClock } from '../../src/clock';
import { buildDispatcher, payloadOf } from '../../src/container';
import { now as stateNow, restartNight, setMoment, setSpeed, type VirtualState } from '../../src/domain/timekeeping/virtual';
import type { Deps } from '../../src/endpoints/types';
import { CLOCK_CHANGE_ACTION, CLOCK_CHANGED_TOPIC } from '../../src/timekeeping/ports';
import { BASE, testDeps } from './helpers';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE_SECRET = randomBytes(24).toString('hex'); // check-secrets: allow test fake
const ACTOR = { kind: 'system' as const, id: 'clock-shared-test', label: 'clock-shared-test' };
const AT = Date.parse('2026-12-31T22:58:00Z');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChildClock {
  status: number;
  value: { now: number; speed: number; frozen: boolean };
  state: VirtualState;
  /** Real instants just before and after B's dispatch. */
  before: number;
  after: number;
}
type Row = Record<string, unknown> & { id: number };

/**
 * A served instant agrees with `state` within `ms`: it lies between the state's instants at the real
 * moments just before and after the request (at speed 600 one real ms is 600 virtual ms).
 */
function within(served: number, state: VirtualState, before: number, after: number, ms: number): boolean {
  return served >= stateNow(state, before) - ms && served <= stateNow(state, after) + ms;
}

describe('shared virtual time across two processes', { timeout: 180_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let dispatch: (r: Request) => Promise<Response>;
  let child: ChildProcessWithoutNullStreams;
  const answers: ChildClock[] = [];
  const shared = () => deps.sharedClock!;

  /** Asks B for its clock; resolves with the next answer. */
  async function askB(): Promise<ChildClock> {
    const before = answers.length;
    child.stdin.write('GET\n');
    for (let i = 0; i < 200 && answers.length === before; i++) await sleep(5);
    const answer = answers[before];
    if (!answer) throw new Error('instance B did not answer');
    return answer;
  }

  const viaEdge = (r: Request) => {
    const headers = new Headers(r.headers);
    headers.set('x-t2f-edge', EDGE_SECRET);
    return dispatch(new Request(r, { headers }));
  };
  const maxId = async (collection: 'audit-log' | 'internal-events') =>
    Number(((await payload.find({ collection, sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (collection: 'audit-log' | 'internal-events', after: number, field: 'action' | 'topic', value: string) =>
    (
      await payload.find({
        collection,
        where: { and: [{ id: { greater_than: after } }, { [field]: { equals: value } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];

  beforeAll(async () => {
    deps = testDeps({}, { T2F_EDGE_SECRET: EDGE_SECRET });
    payload = await payloadOf(deps)();
    dispatch = await buildDispatcher(deps);
    await createTestClock(shared()).reset();
    // AC-50 setup: a stored state with a moved anchor, a speed and a new epoch, before B starts.
    await shared().change(ACTOR, (s, real) => setSpeed(restartNight(setMoment(s, AT, real), real), 60, real));

    child = spawn(process.execPath, [path.join(serverDir, 'node_modules/tsx/dist/cli.mjs'), 'test/integration/support/clock-instance.ts'], {
      cwd: serverDir,
      env: process.env,
      stdio: 'pipe',
    });
    let ready!: () => void;
    let failed!: (e: Error) => void;
    const started = new Promise<void>((res, rej) => {
      ready = res;
      failed = rej;
    });
    let buffer = '';
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.stdout.on('data', (c: Buffer) => {
      buffer += c.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === 'READY') ready();
        else if (line.startsWith('CLOCK ')) answers.push(JSON.parse(line.slice(6)) as ChildClock);
      }
    });
    child.on('exit', (code) => failed(new Error(`instance B exited (${code}) before READY: ${stderr.slice(-500)}`)));
    await started;
  }, 120_000);

  afterAll(async () => {
    child?.stdin.end();
    await new Promise<void>((res) => {
      if (!child || child.exitCode !== null) return res();
      child.once('exit', () => res());
      setTimeout(() => {
        child.kill();
        res();
      }, 5_000).unref();
    });
    if (deps) await createTestClock(shared()).reset();
  });

  it('AC-50: a process started after a change keeps the anchor, speed and run epoch', async () => {
    const a = shared().state();
    const b = await askB();
    expect(b.status).toBe(200);
    expect(b.state).toEqual(a);
    expect(a).toMatchObject({ virtual: true, speed: 60 });
    expect(a.runEpoch).toBeGreaterThanOrEqual(1);
    expect(within(b.value.now, a, b.before, b.after, 50)).toBe(true);
  });

  it('AC-49: a door change on A is served by B within 1 s; A and B differ by ≤ 50 ms', async () => {
    const elapsed: number[] = [];
    for (const [i, body] of [{ at: AT + 60_000, speed: 1, frozen: false }, { speed: 600 }, { at: AT + 3_600_000, frozen: true }].entries()) {
      const t0 = Date.now();
      const res = await viaEdge(new Request(`${BASE}/api/_test/clock`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
      expect(res.status, `change ${i}`).toBe(200);
      const target = shared().state();
      let b = await askB();
      while (b.state.seq !== target.seq && Date.now() - t0 < 1_000) b = await askB();
      const took = Date.now() - t0;
      elapsed.push(took);
      expect(b.state.seq, `change ${i}: B did not see seq ${target.seq} within 1 s`).toBe(target.seq);
      expect(took).toBeLessThanOrEqual(1_000);
      expect(b.value.speed).toBe(target.virtual ? target.speed : 1);
      expect(b.value.frozen).toBe(target.frozen);
      // Between the processes at one real instant: B's cached clock against A's.
      expect(Math.abs(stateNow(b.state, b.after) - stateNow(shared().state(), b.after))).toBeLessThanOrEqual(50);
      expect(within(b.value.now, target, b.before, b.after, 50), `change ${i}: B served ${b.value.now}`).toBe(true);
      const aBefore = Date.now();
      const aRes = await viaEdge(new Request(`${BASE}/api/_test/clock`));
      const aAfter = Date.now();
      const a = ((await aRes.json()) as { value: { now: number } }).value;
      expect(within(a.now, target, aBefore, aAfter, 50), `change ${i}: A served ${a.now}`).toBe(true);
    }
    process.stdout.write(`clock-shared refresh ms: ${JSON.stringify(elapsed)}\n`);
  });

  it('W12, NFR-7: one change = one journal row and one clock.changed event; no secret in the journal', async () => {
    const journal0 = await maxId('audit-log');
    const events0 = await maxId('internal-events');
    await createTestClock(shared()).set({ at: AT, speed: 2 });
    await createTestClock(shared()).reset();
    await createTestClock(shared()).reset(); // already real: nothing written
    const journal = await rowsAfter('audit-log', journal0, 'action', CLOCK_CHANGE_ACTION);
    const events = await rowsAfter('internal-events', events0, 'topic', CLOCK_CHANGED_TOPIC);
    expect(journal).toHaveLength(2);
    expect(events).toHaveLength(2);
    expect(journal[0]).toMatchObject({ actor: { kind: 'system', ref: 'test-door' }, target: { collection: 'clock-state', ref: 'clock-state' } });
    expect(journal[0]?.after).toMatchObject({ virtual: true, speed: 2 });
    expect(journal[1]?.after).toMatchObject({ virtual: false, speed: 1 });
    expect(events.map((e) => e.payload)).toEqual(journal.map((j) => ({ seq: (j.after as VirtualState).seq, runEpoch: (j.after as VirtualState).runEpoch })));
    const all = await rowsAfter('audit-log', 0, 'action', CLOCK_CHANGE_ACTION);
    expect(all.length).toBeGreaterThan(0);
    expect(JSON.stringify(all)).not.toContain(EDGE_SECRET);
  });

  it('W12: a journal failure rolls the change back — the global and the outbox are unchanged', async () => {
    const failing = createPayloadClockStateStore({
      payload: payloadOf(deps),
      journal: { append: async () => Promise.reject(new Error('journal down')) },
      publisher: deps.events!.publisher,
      real: realClock,
    });
    const before = await failing.load();
    const events0 = await maxId('internal-events');
    await expect(failing.change(ACTOR, (s, real) => setMoment(s, AT, real))).rejects.toThrow('journal down');
    const after = await failing.load();
    expect({ ...after, anchorVirtual: 0, anchorReal: 0 }).toEqual({ ...before, anchorVirtual: 0, anchorReal: 0 });
    expect(after.seq).toBe(before.seq);
    expect(await rowsAfter('internal-events', events0, 'topic', CLOCK_CHANGED_TOPIC)).toHaveLength(0);
  });
});
