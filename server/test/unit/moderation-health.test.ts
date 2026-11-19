/** Provider health, AI task state and output checks (SPEC-09 AC-11, AC-14, AC-17 … AC-21, AC-24, AC-32, AC-46; W16 … W18). */
import { describe, expect, it, vi } from 'vitest';
import type { AiStatus } from '@time2fest/contracts';
import { assess, probeDue, probeStreak, type HealthSample } from '../../src/domain/moderation/health';
import { checkTranslation, parseScore } from '../../src/domain/moderation/output';
import { taskState } from '../../src/domain/moderation/state';
import { DEFAULT_THRESHOLDS, outcomeOf } from '../../src/domain/moderation/verdict';
import { createProviderLayer } from '../../src/moderation/providers';
import type { AiProvider, ProviderAnswer } from '../../src/moderation/ports';
import type { AlarmInput } from '../../src/ports';

const S = 1_000;
const T0 = 1_000_000;

/** Manual monotonic clock. */
function manualClock() {
  let t = T0;
  return {
    now: () => t,
    set: (v: number) => {
      t = v;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

type Clock = ReturnType<typeof manualClock>;

/** A scripted provider: each call/probe takes `ms` on the manual clock and answers `ok` or a failure. */
function fakeProvider(id: AiProvider['id'], clock: Clock, configured = true) {
  let probeOk = true;
  const probe = vi.fn(async (): Promise<ProviderAnswer<{ raw: string }>> =>
    probeOk ? { ok: true, value: { raw: '{"score":0}' }, ms: 0 } : { ok: false, kind: 'http', status: 503 },
  );
  const provider: AiProvider = {
    id,
    configured,
    moderate: vi.fn(),
    translate: vi.fn(),
    probe,
  };
  return {
    provider,
    probe,
    setProbeOk(v: boolean) {
      probeOk = v;
    },
    /** One timed result for `layer.call`. */
    answer(ms: number, ok: boolean) {
      return async (): Promise<ProviderAnswer<{ raw: string }>> => {
        clock.advance(ms);
        return ok
          ? { ok: true, value: { raw: '{"score":0.1}' }, usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 }, ms }
          : { ok: false, kind: 'timeout' };
      };
    },
  };
}

function setup(opts: { anthropicConfigured?: boolean } = {}) {
  const clock = manualClock();
  const primary = fakeProvider('anthropic', clock, opts.anthropicConfigured ?? true);
  const backup = fakeProvider('deepseek', clock);
  const alarms: AlarmInput[] = [];
  const lines: Record<string, unknown>[] = [];
  const log = { info: (f: Record<string, unknown>) => lines.push(f), warn: vi.fn(), error: vi.fn() };
  const layer = createProviderLayer({
    providers: { moderation: [primary.provider, backup.provider], translation: [primary.provider, backup.provider] },
    clock,
    alarm: { raise: (a) => alarms.push(a) },
    log,
  });
  const run = async (p: ReturnType<typeof fakeProvider>, ms: number, ok: boolean, n = 1) => {
    for (let i = 0; i < n; i++) await layer.call('moderation', p.provider, p.answer(ms, ok));
  };
  /** Takes a provider down with 3 failures in a row (AC-18). */
  const takeDown = (p: ReturnType<typeof fakeProvider>) => run(p, 100, false, 3);
  /** Ticks every 10 s up to `until` (inclusive), starting 10 s after the current time. */
  const probeUntil = async (until: number) => {
    while (clock.now() + 10 * S <= until) {
      clock.advance(10 * S);
      await layer.tick();
    }
  };
  return { clock, primary, backup, alarms, lines, layer, run, takeDown, probeUntil };
}

const sample = (at: number, ms: number, ok: boolean): HealthSample => ({ at, ms, ok });

describe('assess — the 60 s window (AC-17, AC-18)', () => {
  it('≥20 calls: p95 > 1 s → slow; exactly 1 s is fine', () => {
    const slow = Array.from({ length: 20 }, (_, i) => sample(T0 + i * S, 1_200, true));
    expect(assess(slow, T0 + 20 * S)).toEqual({ status: 'unavailable', reason: 'slow' });
    const edge = Array.from({ length: 20 }, (_, i) => sample(T0 + i * S, 1_000, true));
    expect(assess(edge, T0 + 20 * S).status).toBe('available');
  });

  it('≥20 calls: error share > 5% → unavailable; 1 of 20 (5%) is fine', () => {
    const two = Array.from({ length: 20 }, (_, i) => sample(T0 + i * S, 100, i !== 3 && i !== 10));
    expect(assess(two, T0 + 20 * S)).toEqual({ status: 'unavailable', reason: 'unavailable' });
    const one = Array.from({ length: 20 }, (_, i) => sample(T0 + i * S, 100, i !== 3));
    expect(assess(one, T0 + 20 * S).status).toBe('available');
  });

  it('19 slow calls are below the share rule', () => {
    const slow = Array.from({ length: 19 }, (_, i) => sample(T0 + i * S, 1_200, true));
    expect(assess(slow, T0 + 20 * S).status).toBe('available');
  });

  it('<20 calls: 3 failures in a row → unavailable; 2 do not', () => {
    const three = [sample(T0, 100, true), sample(T0 + 1, 100, true), sample(T0 + 2, 1_000, false), sample(T0 + 3, 1_000, false), sample(T0 + 4, 1_000, false)];
    expect(assess(three, T0 + 5)).toEqual({ status: 'unavailable', reason: 'unavailable' });
    expect(assess(three.slice(0, 4), T0 + 5).status).toBe('available');
  });

  it('samples older than 60 s do not count', () => {
    const old = [sample(T0, 100, false), sample(T0 + 1, 100, false), sample(T0 + 2, 100, false)];
    expect(assess(old, T0 + 60 * S + 2).status).toBe('available');
  });
});

describe('probes (AC-19)', () => {
  const probes = (from: number, to: number, bad?: number) => {
    const out: HealthSample[] = [];
    for (let t = from; t <= to; t += 10 * S) out.push(sample(T0 + t, 50, t !== bad));
    return out;
  };

  it('110 s of clean probes → not yet; 120 s → recovered; a failure at 100 s restarts the run', () => {
    expect(probeStreak(probes(10 * S, 110 * S), T0).recovered).toBe(false);
    expect(probeStreak(probes(10 * S, 120 * S), T0).recovered).toBe(true);
    expect(probeStreak(probes(10 * S, 210 * S, 100 * S), T0)).toEqual({ from: T0 + 100 * S, recovered: false });
    expect(probeStreak(probes(10 * S, 220 * S, 100 * S), T0).recovered).toBe(true);
  });

  it('a probe slower than 1 s counts as a failure', () => {
    const run = probes(10 * S, 120 * S).map((p, i) => (i === 5 ? { ...p, ms: 1_001 } : p));
    expect(probeStreak(run, T0).recovered).toBe(false);
  });

  it('a probe is due every 10 s', () => {
    expect(probeDue(null, T0)).toBe(true);
    expect(probeDue(T0, T0 + 9_999)).toBe(false);
    expect(probeDue(T0, T0 + 10 * S)).toBe(true);
  });
});

describe('taskState (state diagram, AC-32)', () => {
  const up = { status: 'available' as const };
  const down = { status: 'unavailable' as const, reason: 'slow' as const };
  it('maps the two providers and the ceiling', () => {
    expect(taskState({ primary: up, backup: up, ceiling: false })).toEqual({ state: 'available' });
    expect(taskState({ primary: down, backup: up, ceiling: false })).toEqual({ state: 'degraded', reason: 'slow' });
    expect(taskState({ primary: down, backup: { status: 'unavailable', reason: 'unavailable' }, ceiling: false })).toEqual({ state: 'fallback', reason: 'slow' });
    expect(taskState({ primary: up, backup: up, ceiling: true })).toEqual({ state: 'fallback', reason: 'ceiling' });
    expect(taskState({ primary: { status: 'unavailable', reason: 'not-configured' }, backup: up, ceiling: false })).toEqual({ state: 'degraded', reason: 'not-configured' });
  });
});

describe('outcomeOf (AC-11)', () => {
  it('0.49 / 0.5 / 0.79 / 0.8 → allow / review / review / block', () => {
    expect([0.49, 0.5, 0.79, 0.8].map((s) => outcomeOf(s, DEFAULT_THRESHOLDS))).toEqual(['allow', 'review', 'review', 'block']);
  });
});

describe('parseScore (AC-14)', () => {
  it('accepts only {"score": n} with n in [0, 1]', () => {
    expect(parseScore('{"score":0.3}')).toBe(0.3);
    expect(parseScore(' {"score": 0} ')).toBe(0);
    expect(parseScore('{"score":1}')).toBe(1);
    for (const bad of ['allow', '', '{"score":1.5}', '{"score":-0.1}', '{"score":"0.2"}', '{"score":0.2,"why":"x"}', '[0.2]', 'null', '{}', '```json\n{"score":0.1}\n```']) {
      expect(parseScore(bad)).toBeNull();
    }
  });
});

describe('checkTranslation (AC-24)', () => {
  it('empty, >600 chars, a new link or contact → error; links already in the source are fine', () => {
    expect(checkTranslation('привіт', '  ')).toBe('empty');
    expect(checkTranslation('привіт', 'a'.repeat(601))).toBe('too-long');
    expect(checkTranslation('привіт', 'a'.repeat(600))).toBeNull();
    expect(checkTranslation('привіт усім', 'hello all, see evil.com')).toBe('link');
    expect(checkTranslation('привіт усім', 'write to me@mail.com')).toBe('contact');
    expect(checkTranslation('див. time2fest.com', 'see time2fest.com')).toBeNull();
    expect(checkTranslation('див. time2fest.com', 'see time2fest.com or call +380 67 123 45 67')).toBe('contact');
  });
});

describe('provider layer (AC-17 … AC-21, AC-32, AC-46)', () => {
  it('20 calls of 1.2 s → primary slow, moderation degraded, usable is the backup only', async () => {
    const { primary, backup, layer, run } = setup();
    await run(primary, 1_200, true, 19);
    expect(layer.state('moderation').state).toBe('available');
    await run(primary, 1_200, true);
    expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'degraded', reason: 'slow' });
    expect(layer.usable('moderation')).toEqual([backup.provider]);
  });

  it('2 errors of 20 → unavailable', async () => {
    const { primary, layer, run } = setup();
    await run(primary, 100, true, 5);
    await run(primary, 100, false);
    await run(primary, 100, true, 10);
    await run(primary, 100, false);
    await run(primary, 100, true, 2);
    expect(layer.state('moderation').state).toBe('available');
    await run(primary, 100, true);
    expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'degraded', reason: 'unavailable' });
  });

  it('3 timeouts in a row with 5 calls in the window → unavailable', async () => {
    const { primary, layer, run } = setup();
    await run(primary, 100, true, 2);
    await run(primary, 1_000, false, 2);
    expect(layer.state('moderation').state).toBe('available');
    await run(primary, 1_000, false);
    expect(layer.state('moderation').state).toBe('degraded');
  });

  it('S1: 10 answers rejected by `accept` in a row return malformed but keep the provider available', async () => {
    const { primary, layer, lines } = setup();
    for (let i = 0; i < 10; i++) {
      const a = await layer.call('moderation', primary.provider, primary.answer(50, true), () => false);
      expect(a).toEqual({ ok: false, kind: 'malformed' });
    }
    expect(layer.state('moderation').state).toBe('available');
    expect(layer.usable('moderation')).toContain(primary.provider);
    expect(lines.at(-1)).toMatchObject({ outcome: 'rejected', ms: 50, tokensIn: 10 });
    expect(layer.stats().find((x) => x.provider === 'anthropic')).toEqual({
      provider: 'anthropic',
      status: 'available',
      calls: 10,
      p95Ms: 50,
      errorShare: 0,
    });
  });

  it('AC-41: stats give p95 and error share of the window per provider', async () => {
    const { clock, primary, layer, run } = setup();
    await run(primary, 100, true, 18);
    await run(primary, 900, true);
    await run(primary, 300, false);
    const a = layer.stats().find((x) => x.provider === 'anthropic');
    expect(a).toEqual({ provider: 'anthropic', status: 'available', calls: 20, p95Ms: 300, errorShare: 0.05 });
    expect(layer.stats().find((x) => x.provider === 'deepseek')).toEqual({
      provider: 'deepseek',
      status: 'available',
      calls: 0,
      p95Ms: 0,
      errorShare: 0,
    });
    clock.advance(61 * S);
    expect(layer.stats().find((x) => x.provider === 'anthropic')?.calls).toBe(0);
  });

  it('probes every 10 s: 110 s clean → still down, 120 s → back; a failure at 100 s restarts', async () => {
    const { clock, primary, layer, takeDown, probeUntil } = setup();
    await takeDown(primary);
    const down = clock.now();
    await probeUntil(down + 110 * S);
    expect(primary.probe).toHaveBeenCalledTimes(11);
    expect(layer.state('moderation').state).toBe('degraded');
    await probeUntil(down + 120 * S);
    expect(layer.state('moderation').state).toBe('available');
    await layer.tick();
    expect(primary.probe).toHaveBeenCalledTimes(12);

    await takeDown(primary);
    const again = clock.now();
    await probeUntil(again + 90 * S);
    primary.setProbeOk(false);
    await probeUntil(again + 100 * S);
    primary.setProbeOk(true);
    await probeUntil(again + 210 * S);
    expect(layer.state('moderation').state).toBe('degraded');
    await probeUntil(again + 220 * S);
    expect(layer.state('moderation').state).toBe('available');
  });

  it('a tick in between does not probe early', async () => {
    const { clock, primary, backup, layer, takeDown } = setup();
    await takeDown(primary);
    await layer.tick();
    clock.advance(9_999);
    await layer.tick();
    expect(primary.probe).toHaveBeenCalledTimes(1);
    expect(backup.probe).not.toHaveBeenCalled();
  });

  it('available → degraded → fallback → available: exactly 3 notifications; state equals the last; alarms page/log', async () => {
    const { clock, primary, backup, alarms, layer, takeDown, probeUntil } = setup();
    const seen: AiStatus[] = [];
    layer.subscribe((s) => {
      if (s.task === 'moderation') {
        seen.push(s);
        expect(layer.state('moderation')).toEqual(s);
      }
    });
    await takeDown(primary);
    const down = clock.now();
    await takeDown(backup);
    expect(layer.usable('moderation')).toEqual([]);
    await probeUntil(down + 130 * S);
    expect(seen).toEqual([
      { task: 'moderation', state: 'degraded', reason: 'unavailable' },
      { task: 'moderation', state: 'fallback', reason: 'unavailable' },
      { task: 'moderation', state: 'available' },
    ]);
    expect(layer.state('moderation')).toEqual(seen[2]);
    expect(alarms.map((a) => [a.level, a.source, a.code])).toEqual([
      ['log', 'mod', 'moderation_degraded'],
      ['page', 'mod', 'moderation_fallback'],
      ['log', 'mod', 'moderation_recovered'],
    ]);
  });

  it('ceiling: fallback/ceiling, nothing usable, probes still go out; lifting it returns available', async () => {
    const { primary, alarms, layer, takeDown, probeUntil, clock } = setup();
    await takeDown(primary);
    layer.setCeiling(true);
    expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'fallback', reason: 'ceiling' });
    expect(layer.state('translation')).toEqual({ task: 'translation', state: 'fallback', reason: 'ceiling' });
    expect(layer.usable('moderation')).toEqual([]);
    await probeUntil(clock.now() + 20 * S);
    expect(primary.probe).toHaveBeenCalledTimes(2);
    layer.setCeiling(false);
    expect(layer.state('moderation').state).toBe('degraded');
    expect(alarms.at(-2)?.code).toBe('moderation_fallback');
  });

  it('an unconfigured primary is down with reason not-configured and is never probed', async () => {
    const { primary, layer, probeUntil, clock } = setup({ anthropicConfigured: false });
    expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'degraded', reason: 'not-configured' });
    await probeUntil(clock.now() + 200 * S);
    expect(primary.probe).not.toHaveBeenCalled();
    layer.reset();
    expect(layer.state('moderation').reason).toBe('not-configured');
  });

  it('logs one line per call: provider, task, ms, outcome, tokens — no text (AC-46)', async () => {
    const { primary, lines, layer } = setup();
    await layer.call('translation', primary.provider, primary.answer(300, true));
    expect(lines).toEqual([{ event: 'ai-call', provider: 'anthropic', task: 'translation', ms: 300, outcome: 'ok', tokensIn: 10, tokensOut: 2 }]);
  });

  it('reset: everything available again without alarms', async () => {
    const { primary, backup, alarms, layer, takeDown } = setup();
    await takeDown(primary);
    await takeDown(backup);
    const before = alarms.length;
    layer.reset();
    expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'available' });
    expect(alarms).toHaveLength(before);
  });
});
