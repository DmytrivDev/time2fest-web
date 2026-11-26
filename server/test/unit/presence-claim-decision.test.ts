/**
 * SPEC-14 W24 — the pure claim decision: every branch of the flowchart in order, the `retryAfterMs` ranges (AC-26),
 * close + Δ ± 1 ms (AC-27), old windows before / after the celebration end (AC-32, AC-33, via `acceptedMomentsOf`),
 * a missing record past its deadline (AC-18), downtime grants carry the body's source (AC-29), and the input type has
 * no pass flag and no client time (AC-11, AC-34).
 */
import { ratingCloseAt, stampGrantedAt } from '@time2fest/rules/time';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_DB_RETRY_MS,
  CLAIM_RETRY_MAX_MS,
  CLAIM_RETRY_MIN_MS,
  claimDecision,
  type ClaimInput,
  type ClaimWindow,
} from '../../src/domain/presence/claimDecision';
import { finaliseDueAt, missingRecordAt } from '../../src/domain/presence/healthSigns';
import { acceptedMomentsOf, PRESENCE_DELTA_MS } from '../../src/domain/presence/window';

const M = Date.parse('2026-12-31T22:00:00Z');
const M_OLD = M - 600_000;
const ZONES = { zones: [{ midnightMs: M - 3_600_000 }, { midnightMs: M }, { midnightMs: M + 3_600_000 }] };
const CLOSE = ratingCloseAt(ZONES);
const OPEN = stampGrantedAt(M);

const win = (moment: number, p: Partial<ClaimWindow> = {}): ClaimWindow => ({ moment, proofSource: null, record: null, downtime: false, ...p });
const input = (p: Partial<ClaimInput> = {}): ClaimInput => ({
  now: OPEN + 1_000,
  hasStamp: false,
  closeAt: CLOSE,
  currentMoment: M,
  windows: [win(M)],
  source: 'tv',
  ...p,
});

describe('order of the flowchart', () => {
  it('an existing stamp wins over everything, even after the close and for an unknown event', () => {
    expect(claimDecision(input({ hasStamp: true, now: CLOSE + 10 * PRESENCE_DELTA_MS, currentMoment: null }))).toEqual({ kind: 'existing' });
  });

  it('claim-closed only after close + Δ (AC-27); before it the claim is evaluated', () => {
    const before = claimDecision(input({ now: CLOSE + PRESENCE_DELTA_MS - 1, windows: [win(M, { proofSource: 'tv' })] }));
    expect(before.kind).toBe('grant');
    expect(claimDecision(input({ now: CLOSE + PRESENCE_DELTA_MS }))).not.toMatchObject({ error: { reason: 'claim-closed' } });
    expect(claimDecision(input({ now: CLOSE + PRESENCE_DELTA_MS + 1, windows: [win(M, { proofSource: 'tv' })] }))).toEqual({
      kind: 'refuse',
      error: { code: 'conflict', reason: 'claim-closed' },
    });
  });

  it('claim-closed comes before unknown-event; unknown-event before the opening check (AC-28)', () => {
    expect(claimDecision(input({ now: CLOSE + PRESENCE_DELTA_MS + 1, currentMoment: null }))).toMatchObject({ error: { reason: 'claim-closed' } });
    expect(claimDecision(input({ now: M - 10_000, currentMoment: null }))).toEqual({ kind: 'refuse', error: { code: 'not_found', reason: 'unknown-event' } });
    expect(claimDecision(input({ currentMoment: Number.NaN }))).toMatchObject({ error: { code: 'not_found' } });
  });

  it('before m + 15 s → unavailable until m + 15 s, even with a proof (AC-26)', () => {
    expect(claimDecision(input({ now: M - 10_000, windows: [win(M, { proofSource: 'country' })] }))).toEqual({
      kind: 'refuse',
      error: { code: 'unavailable', retryAfterMs: OPEN - (M - 10_000) },
    });
    expect(claimDecision(input({ now: OPEN - 1 }))).toEqual({ kind: 'refuse', error: { code: 'unavailable', retryAfterMs: 1 } });
  });
});

describe('grants', () => {
  it('a proof in the current window → presence at once, before any record, with the proof source (AC-24)', () => {
    expect(claimDecision(input({ now: OPEN + 1_000, windows: [win(M, { proofSource: 'room' })] }))).toEqual({
      kind: 'grant',
      grant: { kind: 'presence', moment: M, grantedAt: OPEN, presenceSource: 'room' },
    });
  });

  it('a proof wins over a downtime and over a healthy record', () => {
    const d = claimDecision(input({ windows: [win(M, { proofSource: 'air', record: 'downtime', downtime: true })] }));
    expect(d).toMatchObject({ kind: 'grant', grant: { kind: 'presence', presenceSource: 'air' } });
    expect(claimDecision(input({ windows: [win(M, { proofSource: 'air', record: 'healthy' })] }))).toMatchObject({ grant: { kind: 'presence' } });
  });

  it('a proof only in an accepted old window → old-moment with the old grantedAt and the journal pair (AC-32)', () => {
    expect(claimDecision(input({ windows: [win(M_OLD, { proofSource: 'tv' }), win(M, { record: 'healthy' })] }))).toEqual({
      kind: 'grant',
      grant: { kind: 'old-moment', moment: M_OLD, grantedAt: stampGrantedAt(M_OLD), presenceSource: 'tv', oldMoment: { old: M_OLD, current: M } },
    });
  });

  it('the current window is preferred over an old one when both have a proof', () => {
    expect(claimDecision(input({ windows: [win(M_OLD, { proofSource: 'country' }), win(M, { proofSource: 'tv' })] }))).toMatchObject({
      grant: { kind: 'presence', moment: M, presenceSource: 'tv' },
    });
  });

  it('each downtime kind → downtime with the body source (AC-29)', () => {
    for (const w of [win(M, { record: 'downtime' }), win(M, { downtime: true }), win(M, { downtime: true, record: 'healthy' })]) {
      expect(claimDecision(input({ source: 'country', windows: [w] }))).toEqual({
        kind: 'grant',
        grant: { kind: 'downtime', moment: M, grantedAt: OPEN, presenceSource: 'country' },
      });
    }
  });

  it('no record past window end + 2 min → downtime (AC-18); one ms earlier → unavailable', () => {
    const at = missingRecordAt(M);
    expect(claimDecision(input({ now: at, windows: [win(M)] }))).toMatchObject({ kind: 'grant', grant: { kind: 'downtime' } });
    expect(claimDecision(input({ now: at - 1, windows: [win(M)] }))).toMatchObject({ kind: 'refuse', error: { code: 'unavailable' } });
  });

  it('a downtime only in an old window → old-moment with the body source (AC-32)', () => {
    expect(claimDecision(input({ windows: [win(M_OLD, { record: 'downtime' }), win(M, { record: 'healthy' })] }))).toEqual({
      kind: 'grant',
      grant: { kind: 'old-moment', moment: M_OLD, grantedAt: stampGrantedAt(M_OLD), presenceSource: 'tv', oldMoment: { old: M_OLD, current: M } },
    });
  });
});

describe('refusals', () => {
  it('no-presence only when every accepted window is healthy, no downtime, no proof (AC-25)', () => {
    expect(claimDecision(input({ windows: [win(M, { record: 'healthy' })] }))).toEqual({ kind: 'refuse', error: { code: 'forbidden', reason: 'no-presence' } });
    // An old window still waiting for its record (a later moment, before its deadline) keeps the answer open.
    expect(claimDecision(input({ windows: [win(M + 60_000), win(M, { record: 'healthy' })] }))).toMatchObject({ error: { code: 'unavailable' } });
    // An old window past its deadline without a record is a downtime (AC-18 applies to every accepted window).
    expect(claimDecision(input({ windows: [win(M_OLD), win(M, { record: 'healthy' })] }))).toMatchObject({ grant: { kind: 'old-moment' } });
    expect(claimDecision(input({ windows: [win(M)] }))).toMatchObject({ error: { code: 'unavailable' } });
  });

  it('the current window is judged even when the caller left it out of the list', () => {
    expect(claimDecision(input({ windows: [] }))).toMatchObject({ error: { code: 'unavailable' } });
  });

  it('waiting for the record → retryAfterMs until the expected finalisation, clamped to 1 000 … 30 000 (AC-26)', () => {
    const due = finaliseDueAt(M);
    const r = (now: number) => {
      const d = claimDecision(input({ now, windows: [win(M)] }));
      return d.kind === 'refuse' && d.error.code === 'unavailable' ? d.error.retryAfterMs : -1;
    };
    expect(r(OPEN)).toBe(Math.min(CLAIM_RETRY_MAX_MS, Math.max(CLAIM_RETRY_MIN_MS, due - OPEN)));
    expect(r(due + 30_000)).toBe(CLAIM_RETRY_MIN_MS);
    for (const now of [OPEN, OPEN + 5_000, due, due + 60_000]) {
      expect(r(now)).toBeGreaterThanOrEqual(CLAIM_RETRY_MIN_MS);
      expect(r(now)).toBeLessThanOrEqual(CLAIM_RETRY_MAX_MS);
    }
    expect(CLAIM_DB_RETRY_MS).toBe(5_000);
  });
});

describe('old windows end with the celebration (AC-33)', () => {
  it('before the end the old moment is accepted; after it only the current window is judged', () => {
    const before = M + 3_600_000;
    const after = M + 3_600_000 + 7 * 86_400_000;
    const decide = (now: number) =>
      claimDecision(
        input({
          now,
          closeAt: Infinity,
          windows: acceptedMomentsOf(M, [M_OLD], now, ZONES).map((m) => (m === M_OLD ? win(m, { proofSource: 'tv' }) : win(m, { record: 'healthy' }))),
        }),
      );
    expect(decide(before)).toMatchObject({ grant: { kind: 'old-moment' } });
    expect(decide(after)).toEqual({ kind: 'refuse', error: { code: 'forbidden', reason: 'no-presence' } });
  });
});

describe('server facts only (AC-11, AC-34)', () => {
  it('the input type has no pass flag and no client time', () => {
    // @ts-expect-error — the pass never enters the decision (AC-34)
    const withPass: ClaimInput = { ...input(), hasPass: true };
    // @ts-expect-error — the client's `at` never enters the decision (AC-11)
    const withAt: ClaimInput = { ...input(), at: M };
    expect(claimDecision(withPass)).toEqual(claimDecision(input()));
    expect(claimDecision(withAt)).toEqual(claimDecision(input()));
  });
});
