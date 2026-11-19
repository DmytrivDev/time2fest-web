/**
 * SPEC-09 W28: the verdict service as the composition root builds it, against the fake AI (both wire
 * formats, in this process on port 0) and this worktree's Postgres (alarm store). AC-10 … AC-16, AC-21,
 * AC-47. Each test starts from a reset fake, reset health windows and a reset spend counter.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAi } from '../../../fakes/ai/server.mjs';
import { alarmStoreOf, moderationOf } from '../../src/endpoints/deps';
import type { Deps, ModerationDeps } from '../../src/endpoints/types';
import { testDeps } from './helpers';

const KEY = 'fake-key-for-tests'; // check-secrets: allow test fake
let url = '';
let close: () => Promise<void>;
let deps: Deps;
let m: ModerationDeps;

type Line = Record<string, unknown>;
function capture() {
  const lines: Line[] = [];
  const push = (l: Line) => void lines.push(l);
  return { lines, log: { info: push, warn: push, error: push } };
}

const aiEnv = (keys = true) => ({
  T2F_AI_ANTHROPIC_URL: url,
  T2F_AI_DEEPSEEK_URL: url,
  ANTHROPIC_API_KEY: keys ? KEY : undefined,
  DEEPSEEK_API_KEY: keys ? KEY : undefined,
});
const control = (provider: 'anthropic' | 'deepseek', knobs: unknown) =>
  fetch(`${url}/_control/${provider}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(knobs) });
const requests = async () => (await (await fetch(`${url}/_control/requests`)).json()) as { provider: string; at: number }[];
const resetAll = async (mod: ModerationDeps) => {
  await fetch(`${url}/_control/reset`, { method: 'POST' });
  mod.spend.reset();
  mod.layer.reset();
};
const timed = async <T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const t = performance.now();
  const value = await work();
  return { value, ms: performance.now() - t };
};

beforeAll(async () => {
  ({ url, close } = await startFakeAi({ port: 0 }));
  deps = testDeps({}, aiEnv());
  m = moderationOf(deps);
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await resetAll(m);
});

describe('SPEC-09 verdict service', () => {
  it('AC-10: a shared-rule violation is block/rules with its reason and no provider request', async () => {
    expect(await m.verdict.verdict({ kind: 'message', text: 'see evil.com now' })).toEqual({ outcome: 'block', source: 'rules', reason: 'link-forbidden' });
    expect(await m.verdict.verdict({ kind: 'toast', text: 'Ну ти й сука, Новий рік!' })).toEqual({ outcome: 'block', source: 'rules', reason: 'word' });
    expect(await requests()).toHaveLength(0);
  });

  it('AC-11: scores 0.49 / 0.5 / 0.79 / 0.8 → allow / review / review / block from the primary', async () => {
    const out: string[] = [];
    for (const score of [0.49, 0.5, 0.79, 0.8]) {
      await control('anthropic', { score });
      const v = await m.verdict.verdict({ kind: 'message', text: 'З Новим роком!' });
      expect(v.source).toBe('primary');
      out.push(v.outcome);
    }
    expect(out).toEqual(['allow', 'review', 'review', 'block']);
    expect((await requests()).every((r) => r.provider === 'anthropic')).toBe(true);
  });

  it.each([429, 529, 503])('AC-12: primary answers %i → the backup verdict in the same request', async (down) => {
    await control('anthropic', { down });
    await control('deepseek', { score: 0.9 });
    expect(await m.verdict.verdict({ kind: 'message', text: 'hello' })).toEqual({ outcome: 'block', source: 'backup' });
  });

  it('AC-12: primary slower than 1 s → the backup verdict, within 2.2 s', async () => {
    await control('anthropic', { delayMs: 2_000 });
    await control('deepseek', { score: 0.1 });
    const { value, ms } = await timed(() => m.verdict.verdict({ kind: 'message', text: 'hello' }));
    expect(value).toEqual({ outcome: 'allow', source: 'backup' });
    expect(ms).toBeLessThan(2_200);
  });

  it('AC-13: both providers 5 s slow → the fallback filter within 2.2 s', async () => {
    await control('anthropic', { delayMs: 5_000 });
    await control('deepseek', { delayMs: 5_000 });
    const { value, ms } = await timed(() => m.verdict.verdict({ kind: 'message', text: 'hello' }));
    expect(value).toEqual({ outcome: 'allow', source: 'fallback' });
    expect(ms).toBeLessThanOrEqual(2_200);
  });

  it.each(['prose', 'empty', 'out-of-range'])('AC-14: primary output %s is a provider error, never allow', async (corrupt) => {
    await control('anthropic', { corrupt, score: 0 });
    await control('deepseek', { score: 0.95 });
    expect(await m.verdict.verdict({ kind: 'message', text: 'hello' })).toEqual({ outcome: 'block', source: 'backup' });
    await control('deepseek', { corrupt });
    // Both malformed: the fallback filter decides, not a provider.
    expect((await m.verdict.verdict({ kind: 'message', text: 'hello' })).source).toBe('fallback');
  });

  it('AC-15: nick — AI score 0.9 → forbidden; "a" → short without a request', async () => {
    await control('anthropic', { score: 0.9 });
    expect(await m.verdict.verdict({ kind: 'nick', text: 'Olena' })).toEqual({ outcome: 'block', source: 'primary', reason: 'forbidden' });
    await fetch(`${url}/_control/reset`, { method: 'POST' });
    expect(await m.verdict.verdict({ kind: 'nick', text: 'a' })).toEqual({ outcome: 'block', source: 'rules', reason: 'short' });
    expect(await requests()).toHaveLength(0);
  });

  it('AC-16: recheck — providers up → primary verdict; both down → unavailable, never the fallback filter', async () => {
    await control('anthropic', { score: 0.6 });
    expect(await m.verdict.recheck({ kind: 'toast', text: 'Happy 2027' })).toEqual({ outcome: 'review', source: 'primary' });
    await control('anthropic', { down: 503 });
    await control('deepseek', { down: 503 });
    expect(await m.verdict.recheck({ kind: 'toast', text: 'Happy 2027' })).toEqual({ outcome: 'unavailable' });
    // Three failures each: the task is now `fallback`, and recheck sends nothing.
    await m.verdict.recheck({ kind: 'toast', text: 'Happy 2027' });
    await m.verdict.recheck({ kind: 'toast', text: 'Happy 2027' });
    expect(m.layer.state('moderation').state).toBe('fallback');
    const before = (await requests()).length;
    expect(await m.verdict.recheck({ kind: 'toast', text: 'Happy 2027' })).toEqual({ outcome: 'unavailable' });
    expect((await requests()).length).toBe(before);
  });

  it('AC-21: degraded raises a log alarm line; fallback raises a page saved in the alarm store', async () => {
    const cap = capture();
    const own = testDeps({ log: cap.log }, aiEnv());
    const mod = moderationOf(own);
    await resetAll(mod);
    const store = alarmStoreOf(own);
    const before = new Set((await store.listOpenPage()).map((a) => a.id));
    await control('anthropic', { down: 503 });
    await control('deepseek', { score: 0.1 });
    for (let i = 0; i < 3; i++) await mod.verdict.verdict({ kind: 'message', text: 'hello' });
    expect(mod.layer.state('moderation')).toEqual({ task: 'moderation', state: 'degraded', reason: 'unavailable' });
    expect(cap.lines.some((l) => l.alarm === 'log' && l.source === 'mod' && l.code === 'moderation_degraded')).toBe(true);
    await control('deepseek', { down: 503 });
    for (let i = 0; i < 3; i++) await mod.verdict.verdict({ kind: 'message', text: 'hello' });
    expect(mod.layer.state('moderation').state).toBe('fallback');
    let saved = false;
    for (let i = 0; i < 30 && !saved; i++) {
      saved = (await store.listOpenPage()).some((a) => !before.has(a.id) && a.source === 'mod' && a.code === 'moderation_fallback');
      if (!saved) await new Promise((r) => setTimeout(r, 100));
    }
    expect(saved).toBe(true);
  });

  it('AC-47: no keys → both providers not-configured, the task in fallback, verdicts from the fallback filter', async () => {
    const bare = moderationOf(testDeps({}, aiEnv(false)));
    expect(bare.layer.state('moderation')).toEqual({ task: 'moderation', state: 'fallback', reason: 'not-configured' });
    expect(await bare.verdict.verdict({ kind: 'message', text: 'hello' })).toEqual({ outcome: 'allow', source: 'fallback' });
    expect(await requests()).toHaveLength(0);
  });
});
