import { afterAll, beforeAll } from 'vitest';
import { createHttpPassport } from '@/lib/api/http/passport';
import type { ProfileFetch } from '@/lib/api/http/profile';
import type { PassportService } from '@/lib/api/contracts/passport';
import { getData } from '@/lib/data/load';
import { ratingCloseAt, stampAcceptUntil, SERVER_CLOCK_TOLERANCE_MS } from '@time2fest/rules/time';
import { describeDomain, type PassportSuiteCtx } from './passport.suite';

const BASE = process.env.T2F_SERVER_URL ?? '';
const ORIGIN = process.env.T2F_HTTP_ORIGIN ?? 'http://localhost:3000';

/** Minimal cookie jar by name (one host): stores `set-cookie`, drops deleted cookies. */
class Jar {
  private readonly cookies = new Map<string, string>();
  store(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const maxAge = attrs
        .map((a) => /^\s*max-age=(-?\d+)/i.exec(a)?.[1])
        .find((v) => v !== undefined);
      const gone = value === '' || (maxAge !== undefined && Number(maxAge) <= 0);
      if (gone) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function door<T>(path: string, body: unknown): Promise<{ status: number; value?: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { value?: T } | null;
  return { status: res.status, value: json?.value };
}

const london = getData().events.find((e) => e.cityId.includes('london')) ?? getData().events[0]!;
const M = london.midnightMs;
let clockNow = M - 3_600_000;

async function clockTo(ms: number): Promise<void> {
  const r = await door('/api/_test/clock', { at: ms, frozen: true });
  if (r.status !== 200) throw new Error(`clock door ${r.status}`);
  clockNow = ms;
}

function makeService(): PassportService {
  const jar = new Jar();
  const raw = async (
    input: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ) => {
    const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
    const cookie = jar.header();
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`${BASE}${input}`, { method: init.method, headers, body: init.body });
    jar.store(res.headers);
    return res;
  };
  return createHttpPassport({ fetch: raw as unknown as ProfileFetch, transport: null });
}

const ctx: PassportSuiteCtx = {
  event: () => ({ eventId: london.id, momentMs: M }),
  clockTo,
  /** Samples every 5 s from the counting start (m - 5 min) past the window end, then the finalisation tick → record `healthy`. */
  async markHealthy() {
    const end = stampAcceptUntil(M, SERVER_CLOCK_TOLERANCE_MS) + 15_000;
    for (let at = M - 310_000; at <= end; at += 5_000) {
      await clockTo(at);
      const r = await door('/api/_test/presence/tick', {});
      if (r.status !== 200) throw new Error(`presence-tick door ${r.status}`);
    }
  },
  async closeRating() {
    await clockTo(ratingCloseAt(getData()) + 60_000);
  },
  async present(svc, eventId) {
    const r = await svc.beat({ eventIds: [eventId], source: 'tv', openedAt: clockNow });
    if (!r.ok) throw new Error(`beat → ${r.error.code}`);
  },
  hasBeat: true,
  pushesGranted: false,
  now: () => clockNow,
};

beforeAll(async () => {
  const r = await door('/api/_test/reset', {});
  if (r.status !== 200) throw new Error(`reset door ${r.status}`);
}, 60_000);

afterAll(async () => {
  await door('/api/_test/clock', { at: Date.now(), speed: 1, frozen: false });
});

describeDomain('passport (http)', makeService, ctx);
