/**
 * SPEC-09 security round 3 (S6, S7), provider layer on a manual clock: a refused request (400 / 413 /
 * 422) is a healthy sample with its own share alarm; a 429 skips the provider for a backoff without a
 * health sample and pages once per episode; the per-process token bucket skips a provider without a
 * health sample. Also the `Retry-After` parse and the adapters' wire text.
 */
import { describe, expect, it, vi } from 'vitest';
import { retryAfter, wireText } from '../../src/adapters/aiHttp';
import { createProviderLayer, type ProviderLayerDeps } from '../../src/moderation/providers';
import type { AiProvider, ProviderAnswer } from '../../src/moderation/ports';
import type { AlarmInput } from '../../src/ports';

const T0 = 1_000_000;

function setup(extra: Partial<ProviderLayerDeps> = {}) {
  let t = T0;
  const clock = { now: () => t };
  const advance = (ms: number) => {
    t += ms;
  };
  const provider = (id: AiProvider['id']): AiProvider => ({
    id,
    configured: true,
    moderate: vi.fn(),
    translate: vi.fn(),
    probe: vi.fn(async (): Promise<ProviderAnswer<{ raw: string }>> => ({ ok: true, value: { raw: '{"score":0}' }, ms: 0 })),
  });
  const primary = provider('anthropic');
  const backup = provider('deepseek');
  const alarms: AlarmInput[] = [];
  const layer = createProviderLayer({
    providers: { moderation: [primary, backup], translation: [primary, backup] },
    clock,
    alarm: { raise: (a) => alarms.push(a) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...extra,
  });
  const answer =
    (a: ProviderAnswer<{ raw: string }>, ms = 50) =>
    async (): Promise<ProviderAnswer<{ raw: string }>> => {
      advance(ms);
      return a;
    };
  const ok = answer({ ok: true, value: { raw: '{"score":0.1}' }, ms: 50 });
  return { layer, primary, backup, alarms, advance, answer, ok };
}

describe('S6: a refused request is not a transport failure', () => {
  it('10 calls answered 400 rejected-request keep moderation available', async () => {
    const { layer, primary, answer } = setup();
    for (let i = 0; i < 10; i++) {
      const a = await layer.call('moderation', primary, answer({ ok: false, kind: 'rejected-request', status: 400 }));
      expect(a).toMatchObject({ ok: false, kind: 'rejected-request' });
    }
    expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'available' });
    expect(layer.usable('moderation').map((p) => p.id)).toEqual(['anthropic', 'deepseek']);
  });

  it('above 20 % rejected-request in a window of ≥ 20 calls → one log alarm moderation_rejected_requests', async () => {
    const { layer, primary, answer, ok, alarms } = setup();
    for (let i = 0; i < 15; i++) await layer.call('moderation', primary, ok);
    for (let i = 0; i < 4; i++) await layer.call('moderation', primary, answer({ ok: false, kind: 'rejected-request', status: 422 }));
    expect(alarms.filter((a) => a.code === 'moderation_rejected_requests')).toHaveLength(0); // 19 calls
    for (let i = 0; i < 6; i++) await layer.call('moderation', primary, answer({ ok: false, kind: 'rejected-request', status: 400 }));
    const raised = alarms.filter((a) => a.code === 'moderation_rejected_requests');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ level: 'log', source: 'mod', details: { provider: 'anthropic', task: 'moderation' } });
    expect(layer.state('moderation').state).toBe('available');
  });

  it('401 / 5xx stay failures: 3 in a row take the primary down', async () => {
    const { layer, primary, answer } = setup();
    for (let i = 0; i < 3; i++) await layer.call('moderation', primary, answer({ ok: false, kind: 'http', status: 401 }));
    expect(layer.usable('moderation').map((p) => p.id)).toEqual(['deepseek']);
  });
});

describe('S7: account saturation and the per-process bucket', () => {
  it('a 429 skips the provider for 10 s with no health sample; one page per episode', async () => {
    const { layer, primary, answer, advance, alarms } = setup();
    for (let i = 0; i < 50; i++) {
      await layer.call('moderation', primary, answer({ ok: false, kind: 'saturated', status: 429 }));
    }
    expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'available' });
    expect(layer.usable('moderation').map((p) => p.id)).toEqual(['deepseek']);
    expect(layer.stats().find((s) => s.provider === 'anthropic' && s.task === 'moderation')).toMatchObject({ calls: 0, status: 'available' });
    expect(alarms.filter((a) => a.code === 'moderation_saturated')).toEqual([
      { level: 'page', source: 'mod', code: 'moderation_saturated', details: { provider: 'anthropic', backoffMs: 10_000 } },
    ]);
    advance(10_000);
    expect(layer.usable('moderation').map((p) => p.id)).toEqual(['anthropic', 'deepseek']);
    await layer.call('moderation', primary, answer({ ok: false, kind: 'saturated', status: 429 }));
    expect(alarms.filter((a) => a.code === 'moderation_saturated')).toHaveLength(2); // a new episode
  });

  it('Retry-After sets the backoff, capped at 60 s', async () => {
    const { layer, primary, answer, advance } = setup();
    await layer.call('moderation', primary, answer({ ok: false, kind: 'saturated', status: 429, retryAfterMs: 300_000 }, 0));
    advance(59_999);
    expect(layer.usable('moderation').map((p) => p.id)).toEqual(['deepseek']);
    advance(1);
    expect(layer.usable('moderation').map((p) => p.id)).toEqual(['anthropic', 'deepseek']);
  });

  it('bucket of 5 a minute: the 6th call skips the primary without touching its health, refills over time', async () => {
    const { layer, primary, ok, advance } = setup({ ratePerMin: { anthropic: 5 } });
    let sent = 0;
    const counted = async () => {
      sent++;
      return ok();
    };
    for (let i = 0; i < 5; i++) expect((await layer.call('moderation', primary, counted)).ok).toBe(true);
    const sixth = await layer.call('moderation', primary, counted);
    expect(sixth).toEqual({ ok: false, kind: 'throttled' });
    expect(sent).toBe(5);
    expect(layer.stats().find((s) => s.provider === 'anthropic' && s.task === 'moderation')).toMatchObject({ calls: 5, errorShare: 0 });
    expect(layer.state('moderation').state).toBe('available');
    advance(12_000); // one token back (5 a minute)
    expect((await layer.call('moderation', primary, counted)).ok).toBe(true);
    expect(sent).toBe(6);
  });
});

describe('S6/S7 adapter helpers', () => {
  it('wireText: lone surrogates become U+FFFD, control characters but a line feed go', () => {
    expect(wireText('hi \uD800')).toBe('hi �');
    expect(wireText('a\u0000b\u0007c\nd\u001Be\u0085f\u007F')).toBe('abc\ndef');
    expect(wireText('ok 😀 ok')).toBe('ok 😀 ok');
  });

  it('retryAfter: seconds, an HTTP date against the response Date, or undefined', () => {
    expect(retryAfter('7', 0)).toBe(7_000);
    expect(retryAfter(new Date(30_000).toUTCString(), 0)).toBe(30_000);
    expect(retryAfter(new Date(30_000).toUTCString(), undefined)).toBeUndefined();
    expect(retryAfter(null, 0)).toBeUndefined();
    expect(retryAfter('soon', 0)).toBeUndefined();
  });
});
