/**
 * SPEC-10 W31 — session events (AC-29): a sign-in publishes `{type:'session', data:{reason:'signed-in'}}` to
 * `user:#<account>` and reconnects the account's connections (`invalidateSubject`, code 3014); a sign-out publishes
 * `signed-out`; a guest signing in gets `signed-out` on the guest's channel (old subject) — all within 3 s.
 * A subscriber connected with the account's own token (from `GET /api/realtime/token`, AC-30) receives the event;
 * Centrifugo's channel history proves each publication. Skips when Centrifugo is unreachable (SPEC-06 AC-62).
 */
import type { Centrifuge, PublicationContext } from 'centrifuge';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildAuthHarness, CookieJar, sessionOf, signIn, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';
import { api, centrifugeClient, connectAndWait, describeRealtime, name } from './realtime-support';

const redis = ownRedis();
const started = new Date();
const EVENT_MS = 3_000;
let pool: pg.Pool;
let h: AuthHarness;
const clients: Centrifuge[] = [];

type Pub = { data?: { type?: string; id?: string; data?: { reason?: string } } };

async function history(channel: string): Promise<Pub[]> {
  const { json } = await api('history', { channel, limit: 20 });
  return ((json.result as { publications?: Pub[] } | undefined)?.publications ?? []) as Pub[];
}

/** Waits for a NEW `session` event with `reason` on `channel` (ids seen before `known` are ignored); ms taken. */
async function newEvent(channel: string, reason: string, known: Set<string>, startedAt: number): Promise<number | undefined> {
  return waitFor(async () => {
    const hit = (await history(channel)).find((p) => p.data?.type === 'session' && p.data.data?.reason === reason && !known.has(p.data.id ?? ''));
    return hit ? performance.now() - startedAt : undefined;
  }, EVENT_MS + 1_000);
}

const idsOf = async (channel: string) => new Set((await history(channel)).map((p) => p.data?.id ?? ''));

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describeRealtime('AC-29: session events', () => {
  it('sign-in → signed-in to the account within 3 s and its connection is invalidated; sign-out → signed-out within 3 s', { timeout: 60_000 }, async () => {
    const to = testEmail('events');
    const first = new CookieJar();
    expect((await signIn(h, redis, first, to)).status).toBe(200);
    const account = (await sessionOf(h, first)).user?.id ?? '';
    expect(account).toMatch(/^[0-9a-f-]{36}$/);

    // A subscriber with the account's own token on its personal channel.
    const token = ((await (await h.call('/api/realtime/token', { jar: first })).json()) as { value: { token: string } }).value.token;
    const client = centrifugeClient(token);
    clients.push(client);
    expect(await connectAndWait(client)).toBe('connected');
    const channel = name('user', account);
    const received: Pub[] = [];
    const sub = client.newSubscription(channel);
    sub.on('publication', (ctx: PublicationContext) => received.push({ data: ctx.data as Pub['data'] }));
    await new Promise<void>((resolve, reject) => {
      sub.once('subscribed', () => resolve());
      sub.once('error', (ctx) => reject(new Error(`subscribe refused ${ctx.error.code}`)));
      sub.subscribe();
    });
    let disconnects = 0;
    client.on('connecting', (ctx) => {
      if (ctx.code === 3014) disconnects += 1;
    });

    let known = await idsOf(channel);
    let t0 = performance.now();
    const second = new CookieJar();
    expect((await signIn(h, redis, second, to)).status).toBe(200);
    const signedIn = await newEvent(channel, 'signed-in', known, t0);
    expect(signedIn).toBeDefined();
    expect(signedIn!).toBeLessThanOrEqual(EVENT_MS);
    expect(await waitFor(async () => (received.some((p) => p.data?.data?.reason === 'signed-in') ? true : undefined), EVENT_MS)).toBe(true);
    expect(await waitFor(async () => (disconnects > 0 ? true : undefined), EVENT_MS)).toBe(true);

    known = await idsOf(channel);
    t0 = performance.now();
    expect((await h.call('/api/auth/sign-out', { body: {}, jar: second })).status).toBe(200);
    const signedOut = await newEvent(channel, 'signed-out', known, t0);
    expect(signedOut).toBeDefined();
    expect(signedOut!).toBeLessThanOrEqual(EVENT_MS);
  });

  it('a guest signing in: signed-out on the guest channel (old subject), signed-in on the account (new)', { timeout: 60_000 }, async () => {
    const jar = new CookieJar();
    const guest = ((await (await writeProbe(h, { jar })).json()) as { value: { subject: string } }).value.subject;
    const guestChannel = name('user', guest);
    const knownGuest = await idsOf(guestChannel);
    const t0 = performance.now();
    expect((await signIn(h, redis, jar, testEmail('events-guest'))).status).toBe(200);
    const account = (await sessionOf(h, jar)).user?.id ?? '';
    const old = await newEvent(guestChannel, 'signed-out', knownGuest, t0);
    expect(old).toBeDefined();
    expect(old!).toBeLessThanOrEqual(EVENT_MS);
    expect(await newEvent(name('user', account), 'signed-in', new Set(), t0)).toBeDefined();
    // No `signed-in` was published for the guest's own creation.
    expect((await history(guestChannel)).some((p) => p.data?.data?.reason === 'signed-in')).toBe(false);
  });
});
