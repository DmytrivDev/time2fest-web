/**
 * SPEC-11 W14 — the attach race (AC-10, FR-ID-10, EC-3, risk Р6), deterministic: no sleeps, every interleaving is
 * forced by a barrier.
 * - SQL level: two `pg.Client`s and a watcher. A runs the attach UPDATE inside an open transaction; B's UPDATE is
 *   sent un-awaited; the watcher polls `pg_stat_activity` until B waits on a lock; then A commits or rolls back.
 *   Same pass → B updates 0 rows; another pass of the same account → B fails with 23505 on
 *   `passes_one_active_per_account` and its pass stays unattached; after a ROLLBACK of A, B succeeds.
 * - App level: two `attachOnSignIn` through a latch inside `RightsDb.tx` (on the transaction client: both calls are
 *   inside their transactions before either UPDATE runs) → exactly one attached pass, one active pass per account.
 * Every case runs ITERATIONS times.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightsDbOfPool } from '../../src/auth/pool';
import { createPassService, type PassService } from '../../src/rights/passes';
import type { RightsDb } from '../../src/rights/ports';

const ITERATIONS = 20;
const END = Date.parse('2027-01-15T00:00:00Z');
const NOW = END - 30 * 86_400_000;
const SEASON = '2026-27';
const tag = `race-${randomUUID().slice(0, 8)}`;
let n = 0;
let pool: pg.Pool;
let a: pg.Client;
let b: pg.Client;
let watcher: pg.Client;

const ATTACH = `UPDATE passes SET attached_user_id = $2::uuid, attached_at = now()
  WHERE id = $1::uuid AND attached_user_id IS NULL AND revoked_at IS NULL AND erased_at IS NULL RETURNING id`;

async function unattached(opts: { device?: string; email?: string; issuedAt?: number } = {}): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO passes (season, source, grant_ref, payment_email, device_id, issued_at)
     VALUES ($1, 'purchase', $2, $3, $4, $5) RETURNING id::text AS id`,
    [SEASON, `${tag}-${(n += 1)}`, opts.email ?? null, opts.device ?? null, new Date(opts.issuedAt ?? NOW)],
  );
  return res.rows[0]!.id;
}

const attachedTo = async (id: string) =>
  (await pool.query<{ u: string | null }>('SELECT attached_user_id::text AS u FROM passes WHERE id = $1::uuid', [id])).rows[0]?.u ?? null;
const activeOf = async (account: string) =>
  (await pool.query<{ c: number }>(
    'SELECT count(*)::int AS c FROM passes WHERE attached_user_id = $1::uuid AND revoked_at IS NULL AND erased_at IS NULL AND season = $2',
    [account, SEASON],
  )).rows[0]!.c;

/** Barrier: resolves once the backend `pid` is waiting on a lock. Polls without sleeping; bounded. */
async function waitsOnLock(pid: number): Promise<void> {
  const deadline = performance.now() + 10_000;
  for (;;) {
    const res = await watcher.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [pid]);
    if (res.rowCount === 1) return;
    if (performance.now() > deadline) throw new Error(`backend ${pid} never waited on a lock`);
  }
}

const pidOf = async (c: pg.Client) => (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;

/** Settles a promise into a value or an error (B's UPDATE must not reject unhandled while A holds the lock). */
const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 6 });
  a = new pg.Client({ connectionString: process.env.DATABASE_URI });
  b = new pg.Client({ connectionString: process.env.DATABASE_URI });
  watcher = new pg.Client({ connectionString: process.env.DATABASE_URI });
  await Promise.all([a.connect(), b.connect(), watcher.connect()]);
});

afterAll(async () => {
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`${tag}-%`]);
  await Promise.all([a.end(), b.end(), watcher.end()]);
  await pool.end();
});

describe('AC-10 SQL level: two connections, B waits on A’s lock', () => {
  it(`same pass: A commits → B updates 0 rows (${ITERATIONS}×)`, { timeout: 60_000 }, async () => {
    const bPid = await pidOf(b);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const pass = await unattached({ device: `${tag}-d${i}` });
      const [u1, u2] = [randomUUID(), randomUUID()];
      await a.query('BEGIN');
      expect((await a.query(ATTACH, [pass, u1])).rowCount).toBe(1);
      const second = settle(b.query(ATTACH, [pass, u2]));
      await waitsOnLock(bPid);
      await a.query('COMMIT');
      const res = await second;
      expect(res.ok && res.v.rowCount).toBe(0);
      expect(await attachedTo(pass)).toBe(u1);
    }
  });

  it(`another pass of the same account: A commits → B gets 23505, its pass stays unattached (${ITERATIONS}×)`, { timeout: 60_000 }, async () => {
    const bPid = await pidOf(b);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const [p1, p2] = [await unattached(), await unattached()];
      const u = randomUUID();
      await a.query('BEGIN');
      expect((await a.query(ATTACH, [p1, u])).rowCount).toBe(1);
      const second = settle(b.query(ATTACH, [p2, u]));
      await waitsOnLock(bPid);
      await a.query('COMMIT');
      const res = await second;
      expect(res.ok).toBe(false);
      expect(!res.ok && res.e).toMatchObject({ code: '23505', constraint: 'passes_one_active_per_account' });
      expect(await attachedTo(p2)).toBeNull();
      expect(await activeOf(u)).toBe(1);
    }
  });

  it(`A rolls back → B attaches (same pass and another pass) (${ITERATIONS}×)`, { timeout: 60_000 }, async () => {
    const bPid = await pidOf(b);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const same = i % 2 === 0;
      const [p1, p2] = [await unattached(), await unattached()];
      const [u1, u2] = same ? [randomUUID(), randomUUID()] : (() => { const u = randomUUID(); return [u, u]; })();
      const target = same ? p1 : p2;
      await a.query('BEGIN');
      expect((await a.query(ATTACH, [p1, u1])).rowCount).toBe(1);
      const second = settle(b.query(ATTACH, [target, u2]));
      await waitsOnLock(bPid);
      await a.query('ROLLBACK');
      const res = await second;
      expect(res.ok && res.v.rowCount).toBe(1);
      expect(await attachedTo(target)).toBe(u2);
      if (!same) expect(await attachedTo(p1)).toBeNull();
    }
  });
});

/** Two arrivals wait for each other inside their transactions; later transactions pass straight through. */
function latched(inner: RightsDb): { db: RightsDb; arrivals: () => number } {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  return {
    arrivals: () => arrived,
    db: {
      query: (text, values) => inner.query(text, values),
      tx: (fn) =>
        inner.tx(async (q) => {
          arrived += 1;
          if (arrived <= 2) {
            if (arrived === 2) open();
            await gate;
          }
          return fn(q);
        }),
    },
  };
}

function service(db: RightsDb): PassService {
  return createPassService({
    db: async () => db,
    now: () => NOW,
    season: () => ({ currentKey: SEASON, currentEndMs: END }),
    publish: async () => undefined,
  });
}

describe('AC-10 app level: two attachOnSignIn through a latch in RightsDb.tx', () => {
  it(`one device pass, two sign-ins from the same device (two accounts, then one account twice) → one attach (${ITERATIONS}×)`, { timeout: 60_000 }, async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const device = `${tag}-dev${i}`;
      const pass = await unattached({ device });
      const oneAccount = i % 2 === 1;
      const [u1, u2] = oneAccount ? (() => { const u = randomUUID(); return [u, u]; })() : [randomUUID(), randomUUID()];
      const l = latched(rightsDbOfPool(pool));
      const svc = service(l.db);
      const [r1, r2] = await Promise.all([
        svc.attachOnSignIn({ account: u1, device, email: null }),
        svc.attachOnSignIn({ account: u2, device, email: null }),
      ]);
      expect(l.arrivals()).toBeGreaterThanOrEqual(2);
      const owner = await attachedTo(pass);
      expect([u1, u2]).toContain(owner);
      if (oneAccount) {
        expect([r1.attached, r2.attached]).toEqual([pass, pass]);
        expect(await activeOf(u1)).toBe(1);
      } else {
        expect([r1, r2].filter((r) => r.attached === pass)).toHaveLength(1);
        expect([r1, r2].filter((r) => r.attached === null)).toHaveLength(1);
        expect((await activeOf(u1)) + (await activeOf(u2))).toBe(1);
      }
    }
  });

  it(`device pass + email pass of one account concurrently → one attached; path (b) takes the earliest (EC-3) (${ITERATIONS}×)`, { timeout: 60_000 }, async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const device = `${tag}-pd${i}`;
      const email = `${tag}-${i}@race.t2f.test`;
      const onDevice = await unattached({ device });
      const earliest = await unattached({ device: `${tag}-other${i}`, email, issuedAt: NOW - 2_000 });
      const later = await unattached({ device: `${tag}-other${i}`, email, issuedAt: NOW - 1_000 });
      const u = randomUUID();
      const l = latched(rightsDbOfPool(pool));
      const svc = service(l.db);
      const [r1, r2] = await Promise.all([
        svc.attachOnSignIn({ account: u, device, email: null }),
        svc.attachOnSignIn({ account: u, device: `${tag}-none${i}`, email }),
      ]);
      expect(await activeOf(u)).toBe(1);
      const won = [r1, r2].filter((r) => r.attached !== null);
      expect(won).toHaveLength(1);
      if (won[0]!.from === 'email') {
        expect(won[0]!.attached).toBe(earliest);
        expect(await attachedTo(onDevice)).toBeNull();
      } else {
        expect(won[0]!.attached).toBe(onDevice);
        expect(await attachedTo(earliest)).toBeNull();
      }
      expect(await attachedTo(later)).toBeNull();
    }
  });

  it('EC-3 and AC-7 without a race: two email passes → the earliest; device and email possible → only the device pass', async () => {
    const email = `${tag}-ec3@race.t2f.test`;
    const first = await unattached({ email, issuedAt: NOW - 5_000 });
    const second = await unattached({ email, issuedAt: NOW - 1_000 });
    const svc = service(rightsDbOfPool(pool));
    const u = randomUUID();
    expect(await svc.attachOnSignIn({ account: u, device: null, email: email.toUpperCase() })).toMatchObject({ attached: first, from: 'email' });
    expect(await attachedTo(second)).toBeNull();

    const device = `${tag}-ac7`;
    const devicePass = await unattached({ device });
    const emailPass = await unattached({ email: `${tag}-ac7@race.t2f.test` });
    const v = randomUUID();
    expect(await svc.attachOnSignIn({ account: v, device, email: `${tag}-ac7@race.t2f.test` })).toMatchObject({ attached: devicePass, from: 'device' });
    expect(await attachedTo(emailPass)).toBeNull();
    // AC-8: an account with its own pass attaches nothing.
    expect(await svc.attachOnSignIn({ account: v, device: null, email: `${tag}-ac7@race.t2f.test` })).toEqual({ attached: null, from: null });
  });
});
