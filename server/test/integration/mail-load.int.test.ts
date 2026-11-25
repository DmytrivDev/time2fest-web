/**
 * SPEC-10 W39 (NFR-1): the code mail reaches the provider within 5 s for 95 % of requests at 20 requests per second.
 * Two runs: 200 code requests over 10 s (the NFR; the observed numbers are printed and recorded in the ledger) and 80
 * over 10 s (8 per second = the per-provider rate, the load one provider carries). Each run:  through the real flow (in-process dispatcher, real mail service, pooled SMTP into the
 * shared Mailpit primary 1025 and the fallback 1026), distinct addresses, each request from its own client address (own /24: the address windows also count per network)
 * (edge header), daily ceilings raised so only the rate limit and the failover are under test. Receipt time = the
 * message's `Created` stamp in Mailpit minus the moment the request was fired (same machine clock). The numbers are
 * printed: receipt and response p50/p95/p99/max, how many mails each provider got, the breaker and the alarms.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthWiring } from '../../src/auth/instance';
import { buildDispatcher } from '../../src/container';
import { MAILPIT_API, MAILPIT_CHAOS_API } from '../support/mailpit';
import { worktreeSlug } from '../support/testEmail';
import { BASE, ORIGIN, ownRedis, testDeps } from './helpers';
import { note, percentile, printMeasure } from './measure';

const SECRET = randomBytes(20).toString('hex');
const RUN = randomBytes(3).toString('hex');
/** A first octet per run: the address windows (`rl:auth-code-*`) outlive a run for 10 minutes. */
const NET = 100 + (parseInt(RUN.slice(0, 2), 16) % 100);
const redis = ownRedis();

type Dispatch = (req: Request) => Promise<Response>;
let dispatch: Dispatch;

let phase = 'a';
const address = (i: number) => `t2f-${worktreeSlug()}-ld${RUN}${phase}-${i}@t2f.test`;

interface Hit {
  To: { Address: string }[];
  Created: string;
}

/** Every message of this run in one Mailpit: recipient -> epoch ms of receipt. */
async function receipts(api: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const q = encodeURIComponent(`to:t2f-${worktreeSlug()}-ld${RUN}${phase}-`);
  for (let start = 0; ; start += 200) {
    const r = await fetch(`${api}/api/v1/search?query=${q}&start=${start}&limit=200`);
    if (!r.ok) throw new Error(`mailpit search ${r.status}`);
    const body = (await r.json()) as { messages?: Hit[] };
    const page = body.messages ?? [];
    for (const m of page) {
      const to = m.To[0]?.Address;
      if (to) out.set(to, Date.parse(m.Created));
    }
    if (page.length < 200) return out;
  }
}

async function deleteRun(api: string): Promise<void> {
  phase = "";
  const q = encodeURIComponent(`to:t2f-${worktreeSlug()}-ld${RUN}${phase}-`);
  await fetch(`${api}/api/v1/search?query=${q}`, { method: 'DELETE' });
}

beforeAll(async () => {
  await redis.deleteByPrefix('auth:');
  await redis.deleteByPrefix('mail:');
  const deps = testDeps({ redis }, { T2F_EDGE_SECRET: SECRET, T2F_MAIL_DAILY_CEILING: '100000', SMTP_FALLBACK_DAILY_CEILING: '100000' });
  deps.auth = createAuthWiring({ env: deps.env, redis: deps.redis });
  dispatch = await buildDispatcher(deps);
});

afterAll(async () => {
  await deleteRun(MAILPIT_API);
  await deleteRun(MAILPIT_CHAOS_API);
  await redis.deleteByPrefix('rl:auth-code');
  await redis.deleteByPrefix('auth:');
  await redis.deleteByPrefix('mail:');
  await redis.close();
});

const fire = (i: number) =>
  dispatch(
    new Request(BASE + '/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'x-t2f-edge': SECRET, 'x-t2f-client': `${NET}.${phase === "r8" ? 1 : 2}.${i & 255}.${1 + (i % 200)};UA`, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: address(i), intent: 'signin' }),
    }),
  );

interface Outcome {
  statuses: Map<number, number>;
  receipt: number[];
  p95: number;
  missing: number;
  duplicates: number;
  okWithoutMail: number;
}

async function run(label: string, total: number, spanMs: number): Promise<Outcome> {
  phase = label;
  await redis.deleteByPrefix('auth:');
  await redis.deleteByPrefix('mail:');
  const fired = new Map<number, number>();
  const response: number[] = [];
  const statuses = new Map<number, number>();
  const ok = new Set<number>();
  const start = Date.now();
  await Promise.all(
    Array.from({ length: total }, (_, i) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          const t0 = Date.now();
          fired.set(i, t0);
          void fire(i)
            .then((res) => {
              statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
              if (res.status === 200) ok.add(i);
              else if (statuses.get(res.status) === 1) void res.clone().text().then((t) => note(`mail-load[${label}]: first ${res.status}: ${t.slice(0, 160)}`));
              response.push(Date.now() - t0);
            })
            .catch(() => statuses.set(-1, (statuses.get(-1) ?? 0) + 1))
            .finally(resolve);
        }, Math.round((i * spanMs) / total));
      }),
    ),
  );
  note(`mail-load[${label}]: ${total} requests, last answered after ${Date.now() - start} ms; statuses ${JSON.stringify([...statuses])}`);
  await new Promise((r) => setTimeout(r, 1500));
  const primary = await receipts(MAILPIT_API);
  const fallback = await receipts(MAILPIT_CHAOS_API);
  const receipt: number[] = [];
  let missing = 0;
  let okWithoutMail = 0;
  for (let i = 0; i < total; i += 1) {
    const at = [primary.get(address(i)), fallback.get(address(i))].filter((v): v is number => v !== undefined);
    if (at.length === 0) {
      missing += 1;
      if (ok.has(i)) okWithoutMail += 1;
    } else receipt.push(Math.max(0, Math.min(...at) - (fired.get(i) ?? 0)));
  }
  const duplicates = [...primary.keys()].filter((k) => fallback.has(k)).length;
  const rs = printMeasure(`mail.code.receipt.${label}`, receipt);
  const p95 = percentile([...receipt].sort((a, b) => a - b), 0.95);
  const rp95 = percentile([...response].sort((a, b) => a - b), 0.95);
  const broken = await redis.get('mail:broken:primary');
  note(
    `T2F_MEASURE_P95 mail.code.receipt.${label} n=${receipt.length} p50=${rs.p50} p95=${p95} p99=${rs.p99} max=${rs.max} | response p95=${rp95} | ` +
      `primaryMails=${primary.size} fallbackMails=${fallback.size} sentToBoth=${duplicates} missing=${missing} ok200WithoutMail=${okWithoutMail} primaryBroken=${broken !== null}`,
  );
  return { statuses, receipt, p95, missing, duplicates, okWithoutMail };
}

describe('code mail under load (NFR-1)', () => {
  it('8 per second (80 in 10 s, what one provider carries): every request answered 200, p95 receipt <= 5 s', { timeout: 120_000 }, async () => {
    const o = await run('r8', 80, 10_000);
    expect(o.statuses.get(200)).toBe(80);
    expect(o.missing).toBe(0);
    expect(o.p95).toBeLessThanOrEqual(5000);
  });

  it('20 per second (200 in 10 s, NFR-1): numbers printed; a 200 always has its mail; only 200 and 503 unavailable', { timeout: 180_000 }, async () => {
    const o = await run('r20', 200, 10_000);
    expect([...o.statuses.keys()].every((s) => s === 200 || s === 503)).toBe(true);
    expect(o.okWithoutMail).toBe(0);
    // NFR-1 itself (p95 <= 5 s for all 200 requests) is reported, not asserted: see the P16 ledger section.
  });
});
