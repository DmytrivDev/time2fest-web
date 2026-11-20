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
import { createVerdictService } from '../../src/moderation/verdict';
import { DEFAULT_SETTINGS } from '../../src/domain/moderation/settings';

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

  // N1 changed the bucket: 80 % of the rate is for non-toast calls, so 25 a minute leaves them 20.
  it('bucket of 25 a minute: the 21st non-toast call skips the primary without touching its health, refills over time', async () => {
    const { layer, primary, ok, advance } = setup({ ratePerMin: { anthropic: 25 } });
    let sent = 0;
    const counted = async () => {
      sent++;
      return ok();
    };
    for (let i = 0; i < 20; i++) expect((await layer.call('moderation', primary, counted)).ok).toBe(true);
    const next = await layer.call('moderation', primary, counted);
    expect(next).toEqual({ ok: false, kind: 'throttled' });
    expect(sent).toBe(20);
    expect(layer.stats().find((s) => s.provider === 'anthropic' && s.task === 'moderation')).toMatchObject({ calls: 20, errorShare: 0 });
    expect(layer.state('moderation').state).toBe('available');
    advance(3_000); // one token back (20 a minute)
    expect((await layer.call('moderation', primary, counted)).ok).toBe(true);
    expect(sent).toBe(21);
  });
});

describe('N1: the toast check has its own share of the bucket; throttled chat pages', () => {
  it('toasts share 5 a minute: 50 toast calls send 5, a chat call right after still goes out', async () => {
    const { layer, primary, ok } = setup({ ratePerMin: { anthropic: 25 } });
    let sent = 0;
    const counted = async () => {
      sent++;
      return ok();
    };
    const toasts: ProviderAnswer<{ raw: string }>[] = [];
    for (let i = 0; i < 50; i++) toasts.push(await layer.call('moderation', primary, counted, undefined, 'toasts'));
    expect(toasts.filter((a) => a.ok)).toHaveLength(5);
    expect(toasts.slice(5).every((a) => !a.ok && a.kind === 'throttled')).toBe(true);
    expect(sent).toBe(5);
    expect((await layer.call('moderation', primary, counted)).ok).toBe(true);
    expect(sent).toBe(6);
  });

  it('a 429 on a toast call pauses only the toast share: no provider-wide skip, no page, chat still goes out', async () => {
    const { layer, primary, ok, answer, advance, alarms } = setup({ ratePerMin: { anthropic: 25 } });
    let sent = 0;
    const counted = async () => {
      sent++;
      return ok();
    };
    const r = await layer.call('moderation', primary, answer({ ok: false, kind: 'saturated', status: 429 }, 0), undefined, 'toasts');
    expect(r).toMatchObject({ ok: false, kind: 'saturated' });
    expect(alarms.filter((a) => a.code === 'moderation_saturated')).toHaveLength(0);
    expect(layer.usable('moderation').map((p) => p.id)).toEqual(['anthropic', 'deepseek']);
    expect(layer.usable('translation').map((p) => p.id)).toEqual(['anthropic', 'deepseek']);
    // Toast calls stay off for the 10 s backoff, chat and translation go out.
    expect(await layer.call('moderation', primary, counted, undefined, 'toasts')).toEqual({ ok: false, kind: 'throttled' });
    expect(sent).toBe(0);
    expect((await layer.call('moderation', primary, counted)).ok).toBe(true);
    expect((await layer.call('translation', primary, counted)).ok).toBe(true);
    expect(sent).toBe(2);
    advance(9_999);
    expect(await layer.call('moderation', primary, counted, undefined, 'toasts')).toEqual({ ok: false, kind: 'throttled' });
    advance(1); // the toast bucket was emptied and refills from the 429 on: 10 s × 5 / min = 0.83 token
    advance(2_000);
    expect((await layer.call('moderation', primary, counted, undefined, 'toasts')).ok).toBe(true);
    expect(alarms.filter((a) => a.code === 'moderation_saturated')).toHaveLength(0);
  });

  it('a toast 429 with Retry-After pauses toasts for it, capped at 60 s', async () => {
    const { layer, primary, ok, answer, advance } = setup();
    await layer.call('moderation', primary, answer({ ok: false, kind: 'saturated', status: 429, retryAfterMs: 300_000 }, 0), undefined, 'toasts');
    advance(59_999);
    expect(await layer.call('moderation', primary, ok, undefined, 'toasts')).toEqual({ ok: false, kind: 'throttled' });
    advance(1);
    expect((await layer.call('moderation', primary, ok, undefined, 'toasts')).ok).toBe(true);
  });

  it('toasts never take the non-toast share: 20 chat calls still go out after the toast share is spent', async () => {
    const { layer, primary, ok, alarms } = setup({ ratePerMin: { anthropic: 25 } });
    for (let i = 0; i < 30; i++) await layer.call('moderation', primary, ok, undefined, 'toasts');
    for (let i = 0; i < 20; i++) expect((await layer.call('moderation', primary, ok)).ok).toBe(true);
    // Throttled toasts are not non-toast attempts: no page.
    expect(alarms.filter((a) => a.code === 'moderation_throttled')).toHaveLength(0);
  });

  it('above 20 % throttled non-toast calls in a window of ≥ 20 → one page moderation_throttled per episode', async () => {
    const { layer, primary, ok, advance, alarms } = setup({ ratePerMin: { anthropic: 25 } });
    for (let i = 0; i < 20; i++) await layer.call('moderation', primary, ok);
    for (let i = 0; i < 5; i++) expect(await layer.call('moderation', primary, ok)).toEqual({ ok: false, kind: 'throttled' });
    expect(alarms.filter((a) => a.code === 'moderation_throttled')).toHaveLength(0); // 5 / 25 = 20 %
    for (let i = 0; i < 10; i++) await layer.call('moderation', primary, ok);
    const raised = alarms.filter((a) => a.code === 'moderation_throttled');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ level: 'page', source: 'mod', details: { provider: 'anthropic', task: 'moderation' } });
    expect(layer.state('moderation').state).toBe('available');
    // The window empties and refills: the episode ends while the share is back ≤ 20 %, a new one pages again.
    advance(61_000);
    for (let i = 0; i < 20; i++) await layer.call('moderation', primary, ok);
    expect(alarms.filter((a) => a.code === 'moderation_throttled')).toHaveLength(1);
    for (let i = 0; i < 20; i++) await layer.call('moderation', primary, ok);
    expect(alarms.filter((a) => a.code === 'moderation_throttled')).toHaveLength(2);
  });
});

describe('N1/N2: verdicts of toasts', () => {
  function verdictSetup() {
    const env = setup({ ratePerMin: { anthropic: 25, deepseek: 25 } });
    const records: { scope: string | undefined; usage: unknown }[] = [];
    const service = createVerdictService({
      layer: env.layer,
      spend: {
        record: (_p, usage, _r, scope) => void records.push({ scope, usage }),
        settings: () => DEFAULT_SETTINGS,
        toastsReached: () => false,
      },
      rules: () => null,
      fallback: () => 'allow',
      clock: { now: () => 0 },
      primary: 'anthropic',
      maxTokens: 32,
    });
    return { ...env, service, records };
  }

  it('toast share spent → the toast falls back without asking the backup; a message after still gets the primary', async () => {
    const { service, primary, backup } = verdictSetup();
    const score = async (): Promise<ProviderAnswer<{ raw: string }>> => ({ ok: true, value: { raw: '{"score":0.1}' }, ms: 1 });
    vi.mocked(primary.moderate).mockImplementation(score);
    vi.mocked(backup.moderate).mockImplementation(score);
    const sources: string[] = [];
    for (let i = 0; i < 50; i++) sources.push((await service.verdict({ kind: 'toast', text: 'hi', budget: 'toasts' })).source);
    expect(sources.slice(0, 5)).toEqual(['primary', 'primary', 'primary', 'primary', 'primary']);
    expect(sources.slice(5).every((s) => s === 'fallback')).toBe(true);
    expect(primary.moderate).toHaveBeenCalledTimes(5);
    expect(backup.moderate).not.toHaveBeenCalled();
    expect(await service.verdict({ kind: 'message', text: 'hi' })).toEqual({ outcome: 'allow', source: 'primary' });
  });

  it('a toast answered 429 → the toast part pauses; a message after still gets the primary, no saturation page', async () => {
    const { service, primary, backup, alarms } = verdictSetup();
    vi.mocked(primary.moderate).mockResolvedValue({ ok: false, kind: 'saturated', status: 429 });
    vi.mocked(backup.moderate).mockResolvedValue({ ok: true, value: { raw: '{"score":0.1}' }, ms: 1 });
    expect(await service.verdict({ kind: 'toast', text: 'hi', budget: 'toasts' })).toEqual({ outcome: 'allow', source: 'backup' });
    vi.mocked(primary.moderate).mockResolvedValue({ ok: true, value: { raw: '{"score":0.1}' }, ms: 1 });
    expect(await service.verdict({ kind: 'message', text: 'hi' })).toEqual({ outcome: 'allow', source: 'primary' });
    expect(alarms.filter((a) => a.code === 'moderation_saturated')).toHaveLength(0);
  });

  it('a toast answered rejected-request or refused moves the toast sub-budget at the estimate', async () => {
    const { service, primary, backup, records } = verdictSetup();
    vi.mocked(primary.moderate).mockResolvedValue({ ok: false, kind: 'rejected-request', status: 400 });
    vi.mocked(backup.moderate).mockResolvedValue({ ok: false, kind: 'refused' });
    expect(await service.verdict({ kind: 'toast', text: 'hi', budget: 'toasts' })).toEqual({ outcome: 'allow', source: 'fallback' });
    expect(records).toEqual([
      { scope: 'toasts', usage: undefined },
      { scope: 'toasts', usage: undefined },
    ]);
    // A chat message refused the same way is not a toast: nothing recorded.
    await service.verdict({ kind: 'message', text: 'hi' });
    expect(records).toHaveLength(2);
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
