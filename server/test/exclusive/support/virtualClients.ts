/**
 * SPEC-14 W47 (AC-65, NFR-3, NFR-6) — virtual presence clients for the exclusive restart test. Each client is a guest
 * subject with its own cookie jar and client address; it beats when its next beat is due on the test clock (the
 * server's `nextBeatMs`, or `retryAfterMs` after an `unavailable` / 429), and claims the stamp with a retry on
 * `unavailable`. The clock is driven by the caller in steps; a client never reads the wall clock for scheduling.
 */
import { CookieJar, freshIp, writeProbe, type AuthHarness } from '../../support/authClient';

export interface VirtualClient {
  readonly jar: CookieJar;
  readonly ip: string;
  readonly subject: string;
  /** Test-clock time of the next beat; `null` = the server said no more beats. */
  nextBeatAt: number | null;
  /** The claim outcome: `granted`, or the last refusal code (`unavailable`, `no-presence`, …). */
  claim: string | null;
  /** Test-clock time of the next claim attempt. */
  nextClaimAt: number;
  grantedAtClock: number | null;
}

export interface BeatTally {
  ok: number;
  unavailable: number;
  limited: number;
  other: number;
}

export interface ClaimTally {
  /** Answers by code: `granted`, `unavailable`, `no-presence`, `rate_limited`, … (every attempt counted). */
  answers: Record<string, number>;
  /** Longest single claim request, wall ms. */
  maxMs: number;
}

/** Runs `fn` over `items` with at most `width` at once. */
export async function pool<T>(items: readonly T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

/** `n` guests through the write probe (a route that needs a subject), each with its own jar and address. */
export async function createClients(h: AuthHarness, n: number, firstBeatAt: (i: number) => number, width = 20): Promise<VirtualClient[]> {
  const out: VirtualClient[] = [];
  await pool(
    Array.from({ length: n }, (_, i) => i),
    width,
    async (i) => {
      const jar = new CookieJar();
      const ip = freshIp();
      const res = await writeProbe(h, { jar, ip });
      if (res.status !== 200) throw new Error(`write-probe answered ${res.status}`);
      const subject = ((await res.json()) as { value: { subject: string } }).value.subject;
      out.push({ jar, ip, subject, nextBeatAt: firstBeatAt(i), claim: null, nextClaimAt: 0, grantedAtClock: null });
    },
  );
  return out;
}

/** Every client whose beat is due at `now` beats once; the next beat follows the server's answer. */
export async function beatDue(h: AuthHarness, clients: readonly VirtualClient[], eventId: string, now: number, tally: BeatTally, width = 25): Promise<void> {
  const due = clients.filter((c) => c.nextBeatAt !== null && c.nextBeatAt <= now);
  await pool(due, width, async (c) => {
    const res = await h.call('/api/presence', { body: { eventIds: [eventId], source: 'tv' }, jar: c.jar, ip: c.ip });
    const body = (await res.json()) as { ok: boolean; value?: { nextBeatMs: number | null }; error?: { code: string; retryAfterMs?: number } };
    if (body.ok) {
      tally.ok += 1;
      c.nextBeatAt = body.value!.nextBeatMs === null ? null : now + body.value!.nextBeatMs;
      return;
    }
    if (body.error?.code === 'unavailable') tally.unavailable += 1;
    else if (body.error?.code === 'rate_limited') tally.limited += 1;
    else tally.other += 1;
    c.nextBeatAt = now + Math.max(1_000, body.error?.retryAfterMs ?? 5_000);
  });
}

/**
 * Every client without a final answer whose claim is due at `now` claims once. `granted` and every refusal other than
 * `unavailable` / `rate_limited` are final.
 */
export async function claimDue(h: AuthHarness, clients: readonly VirtualClient[], eventId: string, at: number, now: number, tally: ClaimTally, width = 25): Promise<void> {
  const due = clients.filter((c) => (c.claim === null || c.claim === 'unavailable' || c.claim === 'rate_limited') && c.nextClaimAt <= now);
  await pool(due, width, async (c) => {
    const t0 = performance.now();
    const res = await h.call('/api/me/stamps', { body: { eventId, source: 'tv', at }, jar: c.jar, ip: c.ip });
    const body = (await res.json()) as { ok: boolean; value?: { eventId: string }; error?: { code: string; reason?: string; retryAfterMs?: number } };
    tally.maxMs = Math.max(tally.maxMs, performance.now() - t0);
    const code = body.ok && body.value?.eventId === eventId ? 'granted' : (body.error?.reason ?? body.error?.code ?? `status-${res.status}`);
    tally.answers[code] = (tally.answers[code] ?? 0) + 1;
    c.claim = code;
    if (code === 'granted') c.grantedAtClock = now;
    else c.nextClaimAt = now + Math.max(1_000, body.error?.retryAfterMs ?? 5_000);
  });
}
