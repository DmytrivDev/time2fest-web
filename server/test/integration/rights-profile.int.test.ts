/**
 * SPEC-11 W22 — profile, nick, flag, settings through the real pipeline (in-process dispatcher, this slot's Postgres,
 * Redis, Centrifugo): the four rule reasons and `review` → `forbidden` (AC-27, AC-28); case/space-insensitive `taken`,
 * own nick again ok, one winner of two parallel writes (AC-29, AC-30); no nick text in logs (AC-32); flags (AC-33);
 * `detectedFlag` from the edge, never from the body (AC-34); settings round trip and refusals (AC-36); the `profile`
 * event ≤3 s in a second tab, 20 changes p95 ≤3 s (AC-35, EC-5, NFR-2); bodies (NFR-4); the 31st write → `rate_limited`
 * (AC-58); providers off → rule reasons (EC-6). The catalog is stubbed (countries UA, PL; zone `utc+2`).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { moderationOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { buildAuthHarness, CookieJar, freshIp, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';
import { api, describeRealtime, name } from './realtime-support';

const redis = ownRedis();
const started = new Date();
const tag = randomBytes(3).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;
const logged: string[] = [];
const outWrites: string[] = [];
const realWrite = process.stdout.write.bind(process.stdout);

const stored = (): StoredCatalog => ({
  season: null,
  zones: [{ zoneId: 'utc+2' }],
  countries: [{ iso: 'UA' }, { iso: 'PL' }],
  cities: [],
  events: [],
  traditions: [],
});

function prepare(deps: Deps): void {
  const sink = (fields: Record<string, unknown>) => void logged.push(JSON.stringify(fields));
  deps.log = { info: sink, warn: sink, error: sink };
  deps.catalogStore = { read: async () => stored() };
}

interface Who {
  jar: CookieJar;
  subject: string;
}
async function guest(): Promise<Who> {
  const jar = new CookieJar();
  const res = await writeProbe(h, { jar });
  expect(res.status).toBe(200);
  return { jar, subject: ((await res.json()) as { value: { subject: string } }).value.subject };
}
const patch = (w: Who, body: unknown, init: { ip?: string; country?: string } = {}) =>
  h.call('/api/me/profile', {
    method: 'PATCH',
    body,
    jar: w.jar,
    ip: init.ip ?? freshIp(),
    ...(init.country ? { headers: {} } : {}),
  });
const get = async (w: Who, headers?: Record<string, string>) => {
  const res = await h.call('/api/me/profile', { jar: w.jar, ...(headers ? { headers } : {}) });
  return { status: res.status, body: (await res.json()) as { ok: boolean; value?: Record<string, any>; error?: { code: string; reason?: string } } };
};
const refusal = async (res: Response) => ((await res.json()) as { ok: boolean; error?: { code: string; reason?: string } });
const nick = (suffix: string) => `Ліра${tag}${suffix}`.slice(0, 20);

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    outWrites.push(String(chunk));
    return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  h = await buildAuthHarness(redis as never, prepare);
});

afterAll(async () => {
  process.stdout.write = realWrite;
  await pool.query('DELETE FROM profiles WHERE updated_at >= $1', [started]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('rl:');
  await redis.close();
});

describe('nick verdict (AC-27, AC-28, AC-32, EC-6)', () => {
  it('four rule reasons on PATCH and nick-check; nothing saved; no nick text in logs', { timeout: 60_000 }, async () => {
    const w = await guest();
    const cases: [string, string][] = [
      ['a', 'short'],
      ['x'.repeat(21), 'long'],
      ['see t.me/ab', 'link'],
      ['my admin nick', 'forbidden'],
    ];
    for (const [text, reason] of cases) {
      const res = await patch(w, { nick: text });
      expect(res.status).toBe(400);
      expect(await refusal(res)).toMatchObject({ ok: false, error: { code: 'validation', reason } });
      const chk = await h.call('/api/chat/nick-check', { body: { nick: text }, jar: w.jar });
      expect(await refusal(chk)).toMatchObject({ ok: false, error: { code: 'validation', reason } });
    }
    expect((await get(w)).body.value?.nick).toBeNull();
    const text = [...logged, ...outWrites].join('\n');
    for (const [t] of cases) expect(text).not.toContain(t);
  });

  it('review → forbidden and the nick is not saved (AC-28)', async () => {
    const w = await guest();
    const m = moderationOf(h.deps);
    const real = m.verdict;
    m.verdict = { ...real, verdict: async () => ({ outcome: 'review', source: 'primary' }) };
    try {
      expect(await refusal(await patch(w, { nick: nick('r') }))).toMatchObject({ error: { code: 'validation', reason: 'forbidden' } });
    } finally {
      m.verdict = real;
    }
    expect((await get(w)).body.value?.nick).toBeNull();
  });

  it('providers off: the rule reasons still apply and a clean nick passes (EC-6)', async () => {
    const w = await guest();
    expect(await refusal(await patch(w, { nick: 'admin' }))).toMatchObject({ error: { reason: 'forbidden' } });
    expect((await patch(w, { nick: nick('e') })).status).toBe(200);
  });
});

describe('uniqueness (AC-29, AC-30)', () => {
  it('taken case/space-insensitively; own nick again ok; parallel writes → one winner', { timeout: 60_000 }, async () => {
    const a = await guest();
    const b = await guest();
    const n = nick('u');
    const first = await patch(a, { nick: n });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { value: { nick: string } }).value.nick).toBe(n);
    expect(await refusal(await patch(b, { nick: ` ${n.toLowerCase()} ` }))).toMatchObject({ error: { code: 'validation', reason: 'taken' } });
    expect(await refusal(await h.call('/api/chat/nick-check', { body: { nick: n.toUpperCase() }, jar: b.jar }))).toMatchObject({ error: { reason: 'taken' } });
    expect((await h.call('/api/chat/nick-check', { body: { nick: n }, jar: a.jar })).status).toBe(200);
    expect((await patch(a, { nick: n })).status).toBe(200);

    const c = await guest();
    const d = await guest();
    const free = nick('p');
    const [rc, rd] = await Promise.all([patch(c, { nick: free }), patch(d, { nick: free })]);
    expect([rc.status, rd.status].sort()).toEqual([200, 400]);
    const loser = rc.status === 400 ? rc : rd;
    expect(await refusal(loser)).toMatchObject({ error: { reason: 'taken' } });
  });
});

describe('flag and detectedFlag (AC-33, AC-34)', () => {
  it('UA and pride ok; XX and a tag → invalid-input; detectedFlag from the edge, body ignored', async () => {
    const w = await guest();
    expect(((await (await patch(w, { flagCode: 'UA' })).json()) as { value: { flagCode: string } }).value.flagCode).toBe('UA');
    expect((await patch(w, { flagCode: 'pride' })).status).toBe(200);
    expect(await refusal(await patch(w, { flagCode: 'XX' }))).toMatchObject({ error: { code: 'validation', reason: 'invalid-input' } });
    expect((await patch(w, { flagCode: '<b>' })).status).toBe(400);
    expect((await get(w)).body.value?.flagCode).toBe('pride');

    const viaEdge = await h.call('/api/me/profile', { jar: w.jar, headers: { 'x-t2f-client': `${freshIp()};PL` } });
    expect(((await viaEdge.json()) as { value: { detectedFlag: string } }).value.detectedFlag).toBe('PL');
    const only = await h.call('/api/me/profile', {
      method: 'PATCH',
      body: { detectedFlag: 'US' },
      jar: w.jar,
      headers: { 'x-t2f-client': `${freshIp()};PL` },
    });
    expect(only.status).toBe(200);
    const body = ((await only.json()) as { value: { detectedFlag: string; flagCode: string } }).value;
    expect(body).toMatchObject({ detectedFlag: 'PL', flagCode: 'pride' });
  });
});

describe('settings (AC-36)', () => {
  it('defaults, full round trip, unknown key and foreign zone → invalid-input', async () => {
    const w = await guest();
    const def = (await get(w)).body.value!;
    expect(def.settings).toEqual({
      hour12: false, homeCountry: null, homeZoneId: null, showPassport: true, showPath: true,
      passportHints: true, quietDefault: false, reminderEmails: true,
    });
    const full = { hour12: true, homeCountry: 'PL', homeZoneId: 'utc+2', showPassport: false, showPath: false, passportHints: false, quietDefault: true, reminderEmails: false };
    expect((await patch(w, { settings: full })).status).toBe(200);
    expect((await get(w)).body.value?.settings).toEqual(full);
    expect((await patch(w, { settings: { hour12: false } })).status).toBe(200);
    expect((await get(w)).body.value?.settings).toEqual({ ...full, hour12: false });
    expect(await refusal(await patch(w, { settings: { nope: true } }))).toMatchObject({ error: { reason: 'invalid-input' } });
    expect(await refusal(await patch(w, { settings: { homeZoneId: 'utc+9' } }))).toMatchObject({ error: { reason: 'invalid-input' } });
    expect((await get(w)).body.value?.settings).toEqual({ ...full, hour12: false });
  });
});

describe('bodies and limits (NFR-4, AC-58)', () => {
  it('4.1 KB is refused; a body with `subject` → invalid-input; no session → defaults without a guest', async () => {
    const w = await guest();
    const big = await patch(w, { nick: 'ok', settings: { homeZoneId: 'z'.repeat(4_200) } });
    expect([400, 413]).toContain(big.status);
    expect(await refusal(await patch(w, { nick: nick('s'), subject: 'other' }))).toMatchObject({ error: { reason: 'invalid-input' } });
    const before = Number((await pool.query('SELECT count(*)::int AS c FROM users WHERE created_at >= $1', [started])).rows[0].c);
    const anon = await h.call('/api/me/profile');
    expect(anon.status).toBe(200);
    expect(((await anon.json()) as { value: { nick: null } }).value.nick).toBeNull();
    expect(Number((await pool.query('SELECT count(*)::int AS c FROM users WHERE created_at >= $1', [started])).rows[0].c)).toBe(before);
  });

  it('the 31st PATCH in a minute → rate_limited', { timeout: 60_000 }, async () => {
    const w = await guest();
    let last = 0;
    for (let i = 0; i < 31; i += 1) last = (await patch(w, { settings: { hour12: i % 2 === 0 } })).status;
    expect(last).toBe(429);
  });
});

describeRealtime('profile event (AC-35, EC-5, NFR-2)', () => {
  type Pub = { data?: { type?: string; id?: string } };
  const history = async (channel: string): Promise<Pub[]> => {
    const { json } = await api('history', { channel, limit: 100 });
    return ((json.result as { publications?: Pub[] } | undefined)?.publications ?? []) as Pub[];
  };

  it('a change in one tab reaches the subject channel in 3 s; 20 changes p95 in 3 s', { timeout: 120_000 }, async () => {
    const w = await guest();
    const channel = name('user', w.subject);
    const seen = new Set((await history(channel)).map((p) => p.data?.id ?? ''));
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      expect((await patch(w, { settings: { hour12: i % 2 === 0 } })).status).toBe(200);
      const hit = await waitFor(async () => {
        const p = (await history(channel)).find((x) => x.data?.type === 'profile' && !seen.has(x.data.id ?? ''));
        if (p) seen.add(p.data!.id ?? '');
        return p ? performance.now() - t0 : undefined;
      }, 4_000);
      expect(hit).toBeDefined();
      times.push(hit!);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.ceil(times.length * 0.95) - 1]!).toBeLessThanOrEqual(3_000);
  });
});
